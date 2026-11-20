import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';
import {
  AnalysesSchema,
  PlanSchema,
  RefineSchema,
  type Ad,
  type Analysis,
  type Plan,
  type Refine,
} from '../shared/types';
import type { AppEnv } from './env';

type Env = AppEnv['Bindings'];

/** On a policy decline, the API re-runs the request on a server-chosen fallback model. */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const MAX_CONTINUATIONS = 4;

export class ClaudeError extends Error {}

function client(env: Env): Anthropic {
  if (!env.ANTHROPIC_API_KEY) throw new ClaudeError('ANTHROPIC_API_KEY n’est pas configurée');
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

/**
 * One structured-output request. Server tools (web search) may pause a long turn
 * (`pause_turn`): the assistant turn is sent back as is and the server resumes.
 */
async function structured<S extends z.ZodType>(
  env: Env,
  schema: S,
  params: {
    system: Anthropic.Beta.BetaTextBlockParam[];
    user: string;
    effort: 'low' | 'medium' | 'high';
    webSearch?: boolean;
  },
): Promise<z.infer<S>> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: params.user }];
  for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
    const response = await client(env).beta.messages.parse({
      model: env.CLAUDE_MODEL,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      system: params.system,
      messages,
      output_config: { effort: params.effort, format: betaZodOutputFormat(schema) },
      ...(params.webSearch
        ? { tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 8 } as const] }
        : {}),
    });
    if (response.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: response.content });
      continue;
    }
    if (response.stop_reason === 'refusal') {
      throw new ClaudeError(`Claude a décliné la demande (${response.stop_details?.category ?? 'raison inconnue'})`);
    }
    if (response.stop_reason === 'max_tokens') throw new ClaudeError('Réponse trop longue, interrompue');
    if (response.parsed_output == null) throw new ClaudeError('Réponse illisible');
    return response.parsed_output as z.infer<S>;
  }
  throw new ClaudeError('La recherche n’a pas abouti');
}

const PREPARE_SYSTEM = `Tu aides un particulier à dénicher de vraies bonnes affaires sur Leboncoin (France).
On te donne sa demande. Avant de chercher des annonces, renseigne-toi sur le web :
- ce qu'il faut privilégier pour cette demande (modèles, versions, motorisations, années, marques fiables…) et ce qu'il faut fuir (défauts connus, séries à problèmes) ;
- les prix de marché d'occasion réalistes, selon l'âge et le kilométrage ;
- les pièges courants dans les annonces de ce type.
Puis propose 3 à 8 recherches Leboncoin complémentaires qui couvrent la demande sans se recouvrir :
plusieurs gammes de prix et de kilométrage quand c'est pertinent, les modèles retenus, des mots-clés utiles.
Pour une « affaire », vise sous le prix de marché sans tomber dans l'arnaque.
Les champs non pertinents (kilométrage hors véhicules…) valent null. Réponds en français.`;

export async function preparePlan(env: Env, prompt: string): Promise<Plan> {
  if (env.MOCK_CLAUDE === '1') return mockPlan(prompt);
  return structured(env, PlanSchema, {
    system: [{ type: 'text', text: PREPARE_SYSTEM }],
    user: `Ma demande :\n${prompt}`,
    effort: 'high',
    webSearch: true,
  });
}

const ANALYSE_SYSTEM = `Tu juges des annonces Leboncoin pour un particulier qui cherche une bonne affaire.
Pour chaque annonce : note son intérêt de 0 à 100 au regard de la demande et du prix de marché,
choisis un verdict (pepite = affaire exceptionnelle et crédible, bonne_affaire, correct, cher,
suspect = prix ou texte qui font craindre une arnaque ou un vice caché, hors_sujet),
distille l'annonce en 2 ou 3 phrases utiles, liste les points forts, les signaux d'alerte
et les questions à poser au vendeur. Sois concret et sceptique. Réponds en français.
Rends exactement une analyse par annonce reçue, avec son id.`;

/** Fields of a listing worth sending to Claude (keeps tokens down). */
function compactAd(ad: Ad) {
  return {
    id: ad.id,
    titre: ad.title,
    prix: ad.price,
    vendeur: ad.seller,
    ville: ad.city,
    publie: ad.date,
    caracteristiques: ad.attributes,
    description: ad.body.length > 1500 ? `${ad.body.slice(0, 1500)}…` : ad.body,
  };
}

export async function analyseAds(env: Env, prompt: string, plan: Plan | null, ads: Ad[]): Promise<Analysis[]> {
  if (env.MOCK_CLAUDE === '1') return ads.map(mockAnalysis);
  const context = plan
    ? `Demande :\n${prompt}\n\nRecherche préalable :\n${plan.research}\n\nCritères :\n- ${plan.criteria.join('\n- ')}`
    : `Demande :\n${prompt}`;
  const result = await structured(env, AnalysesSchema, {
    // Same demand and research for every batch: cached after the first one.
    system: [
      { type: 'text', text: ANALYSE_SYSTEM },
      { type: 'text', text: context, cache_control: { type: 'ephemeral' } },
    ],
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
  if (env.MOCK_CLAUDE === '1') {
    return { prompt: `${prompt}\n(affiné : privilégier les annonces de particuliers)`, rationale: 'Exemple hors ligne.' };
  }
  const describe = (ads: Ad[]) =>
    ads.length ? ads.map((a) => `- ${a.title} · ${a.price ?? '?'} € · ${a.city ?? ''}`).join('\n') : '(aucune)';
  return structured(env, RefineSchema, {
    system: [{ type: 'text', text: REFINE_SYSTEM }],
    user: `Demande actuelle :\n${prompt}\n\nFavoris :\n${describe(favorites)}\n\nMasquées :\n${describe(hidden)}`,
    effort: 'medium',
  });
}

// --- Offline answers (MOCK_CLAUDE=1) ---

function mockPlan(prompt: string): Plan {
  return {
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
