<p align="center"><img src="public/favicon.svg" width="72" alt=""></p>

# La Bonne Pioche

Repère les voitures d'occasion sous-cotées sur Leboncoin. Tu décris ce que tu cherches. Une IA prépare les
recherches, lit les annonces et estime le prix juste de chaque voiture. Pour cela, elle s'appuie sur une
courbe de prix ajustée sur le marché réel.

## Démarrer en 2 minutes

Prérequis : Node 20+ et Chrome.

```bash
npm install
npm run setup   # crée .dev.vars (secrets locaux) et la base SQLite locale
npm run dev     # http://localhost:5199 — mot de passe : pioche
```

Ensuite, installe l'extension Chrome. C'est elle qui lit Leboncoin.

1. Ouvre `chrome://extensions` et active le **mode développeur**.
2. Clique sur **Charger l'extension non empaquetée**, puis choisis le dossier `extension/`.
3. Recharge http://localhost:5199.

Sans clé API, l'IA est **simulée** (`MOCK_AI=1`), ce qui suffit pour parcourir l'interface. Pour de vraies
analyses :

1. Ajoute `OPENAI_API_KEY=sk-...` dans `.dev.vars`.
2. Supprime la ligne `MOCK_AI=1`.
3. Relance `npm run dev`.

Pour utiliser Claude à la place, mets `LLM_PROVIDER=claude` et `ANTHROPIC_API_KEY`.

`.dev.vars` est ignoré par git. Aucune clé ne doit apparaître ailleurs.

## Fonctionnement

1. **Préparer** : l'IA se renseigne sur le web. Elle retient des modèles fiables (« Choix retenus »), avec
   leurs versions, leurs années et des repères de prix, puis écrit les recherches Leboncoin. Tu peux ajouter
   ou retirer un modèle.
2. **Récupérer** : l'extension ouvre ces recherches dans *ton* Chrome, à rythme humain. Elle lit ensuite le
   texte de chaque annonce, une seule fois : les annonces restent archivées un mois.
3. **Analyser** : un petit modèle extrait les faits de chaque annonce (accident, propriétaires, réparations…).
   L'IA attribue ensuite un verdict et une note. « Analyser le prix » ajuste la courbe du modèle sur les
   annonces de toute la France.

La liste propose aussi :
- une carte des annonces ;
- les favoris et les annonces masquées ;
- un message pré-rempli pour le vendeur, dans le formulaire Leboncoin ;
- l'itinéraire depuis ton domicile ;
- une question libre à l'IA sur une annonce.

**Pourquoi une extension ?** Leboncoin interdit l'aspiration automatique de ses annonces. Le serveur ne le
contacte donc jamais : c'est ton navigateur qui lit les pages, comme quand tu navigues toi-même. L'outil
est fait pour un usage personnel et modéré.

## Modèle de prix

Le modèle estime une courbe par modèle de voiture (`server/domain/pricing.ts`) :

```
ln(prix) = c − α·ln(1 + âge) − β·(ln(1 + km/10 000) − ln(1 + 13 000·âge/10 000))
```

- **Âge :** la décote suit une loi de puissance. **Kilométrage :** il compte par son écart au kilométrage
  normal pour l'âge, soit 13 000 km par an.
- **Avant « Analyser le prix » :** la courbe part des repères de prix fournis par l'IA (α ≈ 0,36, β ≈ 0,25).
- **Après :** la courbe est ajustée sur les annonces de toute la France (régression robuste de Huber).
  Les pentes ne sont réajustées qu'à partir de 25 annonces réparties sur au moins 4 années.
- **Texte de l'annonce :** il corrige l'estimation, par exemple −10 % pour un accident léger et −30 % pour un
  accident grave. La correction totale reste comprise entre −35 % et +12 %.

## Architecture

TypeScript partout. Le backend calcule et décide, le front affiche.

```
server/       API Hono sur Cloudflare Workers : routes, base D1 (SQLite), IA (ai.ts, llm-*.ts)
server/domain/  règles métier pures : modèle de prix, estimation, comparables, règles Leboncoin,
              message au vendeur, et view.ts qui prépare chaque annonce pour l'affichage
web/          application React 19 (Vite) : affiche ce que l'API renvoie, pilote l'extension
contracts/    contrat de l'API : types et schémas zod, sans aucune logique
extension/    extension Chrome MV3 : lit recherches, annonces, profils vendeurs ; remplit le message
migrations/   schéma SQL de la base D1
test/         tests Vitest (règles métier, vue des annonces, frontières entre dossiers)
```

- `GET /api/briefs/:id` renvoie chaque annonce avec un champ `view` calculé par le serveur : verdict,
  prix attendu et écart, couleur, caractéristiques, mémo du modèle, filtres, message au vendeur, liens.
- Le serveur donne aussi les pages Leboncoin à faire lire par l'extension : le front ne construit
  aucune URL de recherche.
- `server/` et `web/` ont chacun leur configuration TypeScript (`tsconfig.server.json`,
  `tsconfig.web.json`) et ne partagent que `contracts/`. Un test échoue si `web/` importe du code serveur.

En local, `npm run dev` lance Vite, et le plugin Cloudflare exécute le Worker et D1 dans le même processus.
L'extension dialogue avec la page via `externally_connectable`. Son identifiant est fixe, parce qu'il est
dérivé de la clé publique déclarée dans le manifest.

## Déployer sur Cloudflare

```bash
npx wrangler login
npx wrangler d1 create labonnepioche      # copie le database_id dans wrangler.jsonc
npm run db:migrate:remote
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put APP_PASSWORD      # mot de passe long : pas de limite de tentatives
npx wrangler secret put SESSION_SECRET    # openssl rand -hex 32
npm run deploy
```

Ensuite, dans `extension/manifest.json`, remplace `https://*.workers.dev/*` par l'adresse exacte de ton
déploiement, puis recharge l'extension.

## Commandes

| Commande | Rôle |
| --- | --- |
| `npm run dev` | application et API en local |
| `npm test` | tests |
| `npm run typecheck` | vérification des types |
| `npm run db:migrate:local` | applique les nouvelles migrations en local (fait aussi par `npm run dev`) |

**Coût indicatif avec gpt-5.5 :** quelques dizaines de centimes pour préparer une recherche, environ 1 centime
par annonce analysée. Une annonce n'est analysée à nouveau que si son prix ou son texte change.
