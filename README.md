# Affaires

Trouve les bonnes affaires sur Leboncoin avec une IA (GPT par défaut, ou Claude).

1. **Préparer** : tu décris ce que tu cherches. L’IA se renseigne sur le web (modèles fiables, prix de marché,
   pièges), puis propose plusieurs recherches Leboncoin complémentaires (gammes de prix, kilométrages, mots-clés).
2. **Récupérer** : l'extension Chrome ouvre ces recherches (particuliers uniquement : les vraies affaires ne
   viennent pas des professionnels) dans ton navigateur, lit les annonces affichées et les
   envoie à l'outil. Les annonces hors critères ou qui contiennent un mot disqualifiant (« pour pièces »…)
   sont écartées. La liste devient ce que Leboncoin montre maintenant : les anciennes annonces non revues
   partent (sauf les favoris), celles revues à l'identique gardent leur analyse.
3. **Analyser** : l’IA note chaque annonce (0–100, verdict, prix de marché), la résume, liste les signaux
   d'alerte et les questions à poser.
Chaque version de la demande est gardée ; un nouveau plan remet toutes les annonces à analyser.

La liste ressemble à Leboncoin, un clic ouvre l'annonce sur Leboncoin, et la carte situe les annonces (les
annonces masquées disparaissent de la carte, les favoris sont cerclés de jaune).

## Pourquoi une extension

Leboncoin bloque les robots et interdit l'aspiration automatique de ses annonces. L'outil ne contacte donc jamais
Leboncoin depuis un serveur : c'est ton propre Chrome qui ouvre les pages, comme quand tu navigues, à rythme
humain (une page toutes les 4 à 8 secondes, 2 pages par recherche). Si Leboncoin affiche une vérification,
l'onglet passe au premier plan pour que tu la résolves. Garde un usage personnel et modéré.

## Installer l'extension (une fois)

1. Ouvre `chrome://extensions`, active le **mode développeur** (en haut à droite).
2. **Charger l'extension non empaquetée** → choisis le dossier `extension/` de ce projet.
3. Recharge la page de l'outil. L'avertissement « extension non détectée » disparaît.

**Après le déploiement**, remplace `https://*.workers.dev/*` dans `externally_connectable.matches` de
`extension/manifest.json` par l'adresse exacte de ton outil (par exemple
`https://affaires.ton-compte.workers.dev/*`), puis recharge l'extension. Sinon, n'importe quel site en
`.workers.dev` pourrait lui demander d'ouvrir des recherches Leboncoin. L'extension n'ouvre que des pages de
résultats (`/recherche`), jamais tes messages ou tes favoris.

## Déployer sur Cloudflare (gratuit)

Prérequis : un compte Cloudflare et une clé API OpenAI (platform.openai.com) ou Anthropic.

```bash
npm install
npx wrangler login
npx wrangler d1 create affaires        # copie le database_id affiché dans wrangler.jsonc
npm run db:migrate:remote
npx wrangler secret put OPENAI_API_KEY   # ou ANTHROPIC_API_KEY avec LLM_PROVIDER=claude
npx wrangler secret put APP_PASSWORD   # le mot de passe de connexion à l'outil
npx wrangler secret put SESSION_SECRET # 32 caractères aléatoires ou plus : openssl rand -hex 32
npm run deploy
```

L'adresse affichée (`https://affaires.<ton-compte>.workers.dev`) est ton outil.

Choisis un mot de passe long : la connexion n'a pas de limite de tentatives. Changer `SESSION_SECRET`
déconnecte toutes les sessions.

Le plan gratuit des Workers limite le temps de calcul par requête. Si des erreurs 503 apparaissent pendant
l'analyse, passe au plan Workers Paid (5 $/mois).

## Modèle et coût

`LLM_PROVIDER` dans `wrangler.jsonc` : `openai` (par défaut, modèle `OPENAI_MODEL` = `gpt-5.5`) ou `claude`
(`CLAUDE_MODEL` = `claude-opus-5-5`). Ordre de grandeur : quelques dizaines de centimes pour préparer une
recherche (avec recherche web), et environ 1 centime par annonce analysée. Une annonce n'est analysée qu'une
fois, sauf si son prix ou son texte change.

## Développement local

```bash
cp .dev.vars.example .dev.vars   # MOCK_AI=1 : réponses d'exemple, sans clé API
npm run db:migrate:local
npm run dev
npm test
```

## Structure

- `src/worker/` : API (Hono sur Cloudflare Workers), base D1, consignes données à l'IA (`ai.ts`) et
  fournisseurs (`llm-openai.ts`, `llm-claude.ts`).
- `src/client/` : application React (liste, carte Leaflet / OpenStreetMap).
- `src/shared/` : types partagés et construction des URL de recherche Leboncoin.
- `extension/` : extension Chrome (lecture des pages de résultats Leboncoin).
- `migrations/` : schéma de la base.
