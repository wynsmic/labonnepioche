import { z } from 'zod';

/** One Leboncoin search the plan asks to run. */
export const SearchSchema = z.object({
  label: z.string().describe('Nom court de la recherche, ex. « Corolla hybride < 120 000 km »'),
  why: z.string().describe('Pourquoi cette recherche, en une phrase'),
  category: z
    .number()
    .int()
    .describe('Catégorie Leboncoin (2 = voitures, 3 = motos, 9 = ventes immobilières, 15 = informatique…)'),
  text: z
    .string()
    .describe(
      'Mots-clés Leboncoin, courts : marque et modèle (« toyota yaris »), 1 à 3 mots. Pas de motorisation ni de détails : la recherche porte sur le texte des annonces et en raterait beaucoup',
    ),
  price_min: z.number().int().nullable(),
  price_max: z.number().int().nullable(),
  mileage_min: z.number().int().nullable().describe('Kilométrage minimum (véhicules), sinon null'),
  mileage_max: z.number().int().nullable(),
  regdate_min: z.number().int().nullable().describe('Année minimum de mise en circulation, sinon null'),
  regdate_max: z.number().int().nullable(),
  exclude_keywords: z
    .array(z.string())
    .describe(
      'Expressions qui disent que L’OBJET est hors d’usage (« pour pièces », « moteur HS », « épave », « non roulant »). Jamais une caractéristique (carburant, boîte, équipement) ni la situation du vendeur (« urgent », « vendeur pressé », « départ à l’étranger », « déménagement ») : un vendeur pressé est justement une source d’affaires, les signes d’arnaque se jugent à l’analyse',
    ),
});
export type Search = z.infer<typeof SearchSchema>;

/** What Claude returns when preparing a hunt. */
/** One of the very best choices for the demand: only these are hunted. */
export const PickSchema = z.object({
  name: z.string().describe('Modèle ou référence, ex. « Toyota Yaris III »'),
  tier: z
    .enum(['excellent', 'tres_bon'])
    .describe('excellent = référence du marché ; tres_bon = fiable et adapté, moins demandé (souvent de meilleures affaires)'),
  versions: z
    .array(z.string())
    .describe('Versions, motorisations ou séries retenues, précises (« 1.0 VVT-i 69 ch », « 1.33 Dual VVT-i »)'),
  years: z.string().describe('Années retenues, ex. « 2014–2019 »'),
  why: z.string().describe('Pourquoi c’est un des meilleurs choix, avec les faits qui le prouvent'),
  fair_price: z.string().describe('Prix de marché d’occasion constaté pour ces versions, ex. « 7 000–9 000 € selon km »'),
});
export type Pick = z.infer<typeof PickSchema>;

export const PlanSchema = z.object({
  shortlist: z
    .array(PickSchema)
    .describe(
      'Tous les choix réellement bons pour la demande, autant qu’il y en a, classés excellent / très bon. Exigeant sur la fiabilité, pas sur le nombre. Tout ce qui n’y figure pas est écarté',
    ),
  research: z.string().describe('Synthèse courte : pourquoi ces choix et pas les autres, prix de référence, pièges'),
  criteria: z.array(z.string()).describe('Critères concrets pour juger une annonce d’un modèle retenu'),
  searches: z
    .array(SearchSchema)
    .describe('Recherches Leboncoin ciblées sur les seuls modèles retenus (une ou deux par modèle)'),
});
export type Plan = z.infer<typeof PlanSchema>;

export const VERDICTS = ['pepite', 'bonne_affaire', 'correct', 'cher', 'suspect', 'hors_sujet'] as const;
export type Verdict = (typeof VERDICTS)[number];

/** Claude's reading of one listing. */
export const AnalysisSchema = z.object({
  id: z.string(),
  score: z.number().int().describe('0 à 100 : intérêt de l’affaire au regard de la demande'),
  verdict: z.enum(VERDICTS),
  market_price: z.number().int().nullable().describe('Prix de marché estimé, sinon null'),
  summary: z.string().describe('L’annonce distillée en 2 ou 3 phrases : l’essentiel, sans le blabla du vendeur'),
  positives: z.array(z.string()),
  red_flags: z.array(z.string()),
  questions: z.array(z.string()).describe('Questions à poser au vendeur'),
});
export type Analysis = z.infer<typeof AnalysisSchema>;

/** Second look at one listing, with the national comparison in hand. */
export const VerificationSchema = z.object({
  verdict: z.enum(VERDICTS),
  score: z.number().int().describe('0 à 100, comme pour l’analyse'),
  cause: z.string().describe('La raison principale du verdict en 3 à 6 mots, chiffrée si possible (ex. « 18 % sous le marché, peu de km »)'),
  detail: z
    .string()
    .describe('2 à 4 phrases : ce que montre la comparaison (chiffres), ce qui confirme ou contredit l’affaire, ce qu’il reste à vérifier'),
});
export type Verification = z.infer<typeof VerificationSchema> & { at: string; comparables: number; match: 'motorisation' | 'modele' | null };

export const AnalysesSchema = z.object({ analyses: z.array(AnalysisSchema) });

export const RefineSchema = z.object({
  prompt: z.string().describe('La demande réécrite, prête à l’emploi'),
  rationale: z.string().describe('Ce qui a changé et pourquoi, en 2 ou 3 phrases'),
});
export type Refine = z.infer<typeof RefineSchema>;

/** A listing as read from a Leboncoin results page (see extension/extract.js). */
export interface Ad {
  id: string;
  url: string;
  title: string;
  body: string;
  price: number | null;
  date: string | null;
  city: string | null;
  zipcode: string | null;
  lat: number | null;
  lng: number | null;
  image: string | null;
  seller: 'pro' | 'private' | null;
  attributes: Record<string, string>;
}

export interface StoredAd extends Ad {
  searchLabel: string | null;
  /** Price when the listing was first collected. */
  firstPrice: number | null;
  comparison: import('./compare').Comparison | null;
  verification: Verification | null;
  firstSeen: string;
  favorite: boolean;
  hidden: boolean;
  analysis: Analysis | null;
}

export interface Brief {
  id: string;
  title: string;
  prompt: string;
  /** The places as typed ("Rennes 30 km, Saint-Malo"). */
  zone: string | null;
  locations: string | null;
  updatedAt: string;
}
