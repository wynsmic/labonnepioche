import {
  AnalysesSchema,
  PlanSchema,
  RefineSchema,
  type Ad,
  type Analysis,
  type Plan,
  type Refine,
} from '../shared/types';
import { ageInDays } from '../shared/compare';
import { llm, type Env } from './llm';

const PREPARE_SYSTEM = `Tu aides un particulier à dénicher de vraies bonnes affaires sur Leboncoin (France).
On te donne sa demande et une recherche déjà faite sur le web.
Principe : on ne garde QUE des choix réellement bons. Il ne s'agit pas d'éviter les mauvais, mais de ne
retenir que ce qui est recommandable pour la demande, sans en oublier : un choix fiable mais moins demandé
est souvent là où se cachent les pépites. Construis la shortlist (autant de choix que la demande en justifie, versions précises, niveau
excellent ou très bon), puis des critères, puis des recherches Leboncoin qui ne ciblent que ces choix
(une par choix, fourchettes de prix et de kilométrage cohérentes avec leur prix de marché).
Mots d'exclusion : seulement ce qui dit que l'objet est hors d'usage, jamais la situation du vendeur
(urgent, pressé, départ, déménagement : ce sont des occasions d'affaires).
Une « affaire » = un choix de la shortlist, en bon état prouvé, sous son prix de marché, sans signe d'arnaque.
Les champs non pertinents (kilométrage hors véhicules…) valent null. Réponds en français.`;

const RESEARCH_SYSTEM = `Tu aides un particulier à dénicher de vraies bonnes affaires sur Leboncoin (France).
Ton but : trouver les MEILLEURS choix pour sa demande, pas lister ce qu'il faut éviter.
Cherche sur le web les références reconnues comme les meilleures par plusieurs sources indépendantes
(fiabilité mesurée, retours de propriétaires, études de fiabilité, coûts d'usage, adéquation à la demande).
Pour chaque choix retenu : versions ou motorisations précises, années, preuves de sa supériorité,
prix de marché d'occasion réaliste. Sois exigeant sur la fiabilité, pas sur le nombre : couvre tous les
choix réellement bons, autant qu'il y en a pour cette demande, y compris les moins connus ou moins demandés, qui se revendent moins cher
pour une qualité équivalente. Distingue les références (excellent) des très bons choix. Dis en une phrase
pourquoi les alternatives connues ne sont pas retenues.
Rédige une synthèse factuelle et chiffrée en français, sans proposer encore de recherches Leboncoin.`;

/**
 * Two steps: web research as plain text (web results come with citations, which structured
 * output does not accept), then the plan built from that research.
 */
export async function preparePlan(env: Env, prompt: string): Promise<Plan> {
  if (env.MOCK_AI === '1') return mockPlan(prompt);
  const model = llm(env);
  const research = await model.webResearch(RESEARCH_SYSTEM, `Ma demande :\n${prompt}`);
  return model.structured(PlanSchema, {
    system: PREPARE_SYSTEM,
    user: `Ma demande :\n${prompt}\n\nRecherche déjà faite sur le web :\n${research}`,
    effort: 'high',
  });
}

const ANALYSE_SYSTEM = `Tu juges des annonces Leboncoin pour un particulier qui cherche une bonne affaire.
Règle principale : seuls les choix de la shortlist comptent (modèle ET version ou motorisation ET années).
- Annonce hors shortlist : verdict hors_sujet, score 10 au plus, même si le prix est bas.
- Un choix « excellent » comme un « très bon » peut être une pépite si le prix est nettement sous son marché.
- Un vendeur pressé (urgent, départ, déménagement) est une chance de bonne affaire, pas un défaut ;
  ce n'est un signal d'alerte que combiné à des signes d'arnaque (paiement à distance, objet à l'étranger,
  prix irréaliste).
- Version ou motorisation impossible à confirmer d'après l'annonce : score 50 au plus, et la question
  pour la vérifier parmi les questions au vendeur.
Pour chaque annonce : note son intérêt de 0 à 100 au regard de la demande et du prix de marché,
choisis un verdict (pepite = affaire exceptionnelle et crédible, bonne_affaire, correct, cher,
suspect = prix ou texte qui font craindre une arnaque ou un vice caché, hors_sujet),
distille l'annonce en 2 ou 3 phrases utiles, liste les points forts, les signaux d'alerte
et les questions à poser au vendeur. Sois concret et sceptique. Réponds en français.
Fraîcheur (champ en_ligne_depuis_jours) : une vraie pépite part en quelques heures ou quelques jours.
- Plus de 3 jours en ligne avec un prix très bas : jamais « pepite » ; c'est un signal d'alerte
  (défaut caché, prix d'appel, arnaque ou annonce déjà vendue) à mentionner dans red_flags.
- Plus de 14 jours : le marché l'a probablement jugée trop chère ou problématique ; dis-le.
Rends exactement une analyse par annonce reçue, avec son id.`;

function formatShortlist(plan: Plan): string {
  // Plans saved before the shortlist existed have none.
  return (plan.shortlist ?? [])
    .map((p) => `- ${p.name} (${p.tier === 'excellent' ? 'excellent' : 'très bon'}) — ${p.versions.join(', ')} — ${p.years} — prix de marché ${p.fair_price}`)
    .join('\n');
}

/** Fields of a listing worth sending to Claude (keeps tokens down). */
function compactAd(ad: Ad) {
  return {
    id: ad.id,
    titre: ad.title,
    prix: ad.price,
    vendeur: ad.seller,
    ville: ad.city,
    publie: ad.date,
    en_ligne_depuis_jours: (() => {
      const days = ageInDays(ad.date);
      return days == null ? null : Math.round(days * 10) / 10;
    })(),
    caracteristiques: ad.attributes,
    description: ad.body.length > 1500 ? `${ad.body.slice(0, 1500)}…` : ad.body,
  };
}

export async function analyseAds(env: Env, prompt: string, plan: Plan | null, ads: Ad[]): Promise<Analysis[]> {
  if (env.MOCK_AI === '1') return ads.map(mockAnalysis);
  const context = plan
    ? [
        `Demande :\n${prompt}`,
        `Shortlist (seuls choix acceptés) :\n${formatShortlist(plan)}`,
        `Recherche préalable :\n${plan.research}`,
        `Critères :\n- ${plan.criteria.join('\n- ')}`,
      ].join('\n\n')
    : `Demande :\n${prompt}`;
  const result = await llm(env).structured(AnalysesSchema, {
    // Same demand and research for every batch: cached after the first one.
    system: ANALYSE_SYSTEM,
    context,
    user: `Annonces à juger :\n${JSON.stringify(ads.map(compactAd))}`,
    effort: 'medium',
  });
  const wanted = new Set(ads.map((a) => a.id));
  return result.analyses.filter((a) => wanted.has(a.id));
}

const REFINE_SYSTEM = `Tu aides à affiner une demande de recherche de bonnes affaires sur Leboncoin.
On te donne la demande actuelle, ce que la personne a mis en favori et ce qu'elle a masqué.
Déduis ses préférences implicites et réécris la demande pour qu'elle les dise explicitement
(budget, critères, exclusions, priorités). Garde sa voix, reste concis. Réponds en français.`;

export async function refinePrompt(
  env: Env,
  prompt: string,
  favorites: Ad[],
  hidden: Ad[],
): Promise<Refine> {
  if (env.MOCK_AI === '1') {
    return { prompt: `${prompt}\n(affiné : privilégier les annonces de particuliers)`, rationale: 'Exemple hors ligne.' };
  }
  const describe = (ads: Ad[]) =>
    ads.length ? ads.map((a) => `- ${a.title} · ${a.price ?? '?'} € · ${a.city ?? ''}`).join('\n') : '(aucune)';
  return llm(env).structured(RefineSchema, {
    system: REFINE_SYSTEM,
    user: `Demande actuelle :\n${prompt}\n\nFavoris :\n${describe(favorites)}\n\nMasquées :\n${describe(hidden)}`,
    effort: 'medium',
  });
}

// --- Offline answers (MOCK_AI=1) ---

function mockPlan(prompt: string): Plan {
  return {
    shortlist: [
      {
        name: 'Toyota Yaris III',
        tier: 'excellent',
        versions: ['1.0 VVT-i 69 ch', '1.33 Dual VVT-i'],
        years: '2014–2019',
        why: 'Exemple hors ligne',
        fair_price: '7 000–9 000 €',
      },
    ],
    research: `**Exemple hors ligne** pour : ${prompt.slice(0, 80)}\n\nToyota Yaris/Corolla hybrides et Honda Jazz sont réputées fiables.`,
    criteria: ['Entretien suivi', 'Moins de 150 000 km', 'Prix sous la cote'],
    searches: [
      {
        label: 'Yaris hybride récente',
        why: 'Fiable, consommation faible',
        category: 2,
        text: 'yaris hybride',
        price_min: 6000,
        price_max: 12000,
        mileage_min: null,
        mileage_max: 120000,
        regdate_min: 2014,
        regdate_max: null,
        exclude_keywords: ['pour pièces', 'moteur hs'],
      },
      {
        label: 'Honda Jazz économique',
        why: 'Très robuste, prix bas',
        category: 2,
        text: 'honda jazz',
        price_min: null,
        price_max: 7000,
        mileage_min: null,
        mileage_max: 160000,
        regdate_min: 2010,
        regdate_max: null,
        exclude_keywords: ['pour pièces'],
      },
    ],
  };
}

function mockAnalysis(ad: Ad): Analysis {
  const score = Math.abs([...ad.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % 100;
  return {
    id: ad.id,
    score,
    verdict: score > 80 ? 'pepite' : score > 60 ? 'bonne_affaire' : score > 35 ? 'correct' : 'cher',
    market_price: ad.price ? Math.round(ad.price * 1.1) : null,
    summary: `Exemple hors ligne : ${ad.title}.`,
    positives: ['Annonce détaillée'],
    red_flags: score < 30 ? ['Prix au-dessus du marché'] : [],
    questions: ['Factures d’entretien disponibles ?'],
  };
}
