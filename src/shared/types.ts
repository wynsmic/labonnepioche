import { z } from 'zod';

/** One Leboncoin search the plan asks to run. */
export const SearchSchema = z.object({
  label: z.string().describe('Nom court de la recherche, ex. « Corolla hybride < 120 000 km »'),
  pick: z.string().describe('Nom EXACT (champ name) du choix de la shortlist que cette recherche cible'),
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
  required_groups: z
    .array(z.array(z.string()))
    .describe(
      'Pour ne garder que la VERSION de la shortlist sans restreindre la recherche Leboncoin : chaque groupe est une liste de synonymes dont au moins un doit figurer dans l’annonce (titre, description ou caractéristiques). Ex. Corolla Touring Sports hybride : [["touring", "ts", "break", "sw"], ["hybride", "hybrid", "hsd"]]. Seulement des mots que presque toutes les annonces de cette version contiennent (carrosserie, carburant ou type de motorisation : « break », « hybride »). Jamais de cylindrée, de puissance ni de finition (beaucoup de vendeurs les omettent : l’analyse les vérifie). Pas d’année ni de prix. [] si le modèle suffit',
    ),
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
  tagline: z
    .string()
    .describe('À quoi rime ce modèle, 8 mots maximum, pour se le rappeler d’un coup d’œil (ex. « Break hybride sobre, fiabilité de référence »)'),
  tags: z
    .array(z.string())
    .describe(
      '3 à 5 repères chiffrés ou distinctifs, vraiment utiles pour choisir, 4 mots maximum chacun (ex. « 4,5 l/100 km », « coffre 596 l », « chaîne de distribution », « boîte e-CVT »)',
    ),
  trims: z
    .array(
      z.object({
        name: z.string().describe('Finition telle qu’écrite dans les annonces (« Dynamic », « Design », « GR Sport »)'),
        note: z.string().describe('Ce qu’elle vaut, 8 mots maximum (« milieu de gamme, caméra et clim auto »)'),
      }),
    )
    .describe('Les finitions courantes de ces versions sur le marché d’occasion, de la plus simple à la plus équipée'),
});
/** Market price points of a shortlist choice, asked separately from the plan (a lighter call). */
export const PricePointsSchema = z.object({
  models: z.array(
    z.object({
      name: z.string().describe('Nom EXACT du choix de la shortlist'),
      price_points: z
    .array(
      z.object({
        year: z.number().int().describe('Année de mise en circulation'),
        km: z.number().int().describe('Kilométrage typique pour cette année'),
        price: z.number().int().describe('Prix de marché constaté entre particuliers, bon état, version courante, en euros'),
      }),
    )
    .describe(
      '4 à 6 prix de marché d’occasion constatés pour ces versions, à des années différentes couvrant les années retenues (et un peu au-delà), chacun avec un kilométrage typique (≈ 13 000 km/an). Sert de courbe de prix du modèle avant l’analyse des annonces',
    ),
    }),
  ),
});
export type Pick = z.infer<typeof PickSchema> & {
  /** Added after the plan (PricePointsSchema); absent on older plans. */
  price_points?: { year: number; km: number; price: number }[];
};

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
  market_price: z
    .number()
    .int()
    .nullable()
    .describe('Prix de marché estimé pour CETTE annonce (année, km, version, état) ; null seulement si l’objet est impossible à identifier'),
  new_price: z
    .number()
    .int()
    .nullable()
    .describe('Prix catalogue neuf de cette version à son année de sortie, en euros ; null si inconnu ou si ce n’est pas un véhicule'),
  summary: z
    .string()
    .describe('UNE phrase de 15 mots maximum : ton jugement (version exacte, état, ce qui fait ou défait l’affaire). Ne répète ni le prix, ni l’année, ni le km, ni l’écart au marché : ils sont affichés à côté'),
  positives: z
    .array(z.string())
    .describe('3 au plus, 8 mots maximum chacun, style télégraphique ; sur la voiture et l’annonce, pas sur l’écart de prix (déjà affiché)'),
  red_flags: z
    .array(z.string())
    .describe('3 au plus, les plus graves d’abord, 10 mots maximum chacun ; pas l’écart de prix lui-même (déjà affiché)'),
  questions: z
    .array(z.string())
    .describe(
      'Questions propres à CETTE annonce, à poser au vendeur : 2 au plus, les plus utiles. Une question par sujet (regroupe ce qui va ensemble, ex. « Pourriez-vous m’envoyer le rapport Autoviza ? » plutôt que deux questions sur ce rapport). Ton neutre et bienveillant, jamais soupçonneux : pas de « pourquoi », pas de reproche. Courtes, écrites comme on les enverrait. Pas les questions habituelles (frais, CT, import, accident, entretien), déjà posées',
    ),
});
export type Analysis = z.infer<typeof AnalysisSchema>;

/** Second look at one listing, with the national comparison in hand. */
export const VerificationSchema = z.object({
  verdict: z.enum(VERDICTS),
  score: z.number().int().describe('0 à 100, comme pour l’analyse'),
  cause: z
    .string()
    .describe('Ce qui explique le verdict AU-DELÀ de l’écart de prix (déjà affiché), 3 à 6 mots (ex. « annonce vide, CT non valide », « historique complet, peu de km »)'),
  detail: z
    .string()
    .describe('3 points au plus, une ligne chacun, séparés par « \n » : ce que montre la comparaison (chiffres), ce qui confirme ou contredit l’affaire, ce qu’il reste à vérifier'),
});
export type Verification = z.infer<typeof VerificationSchema> & {
  at: string;
  /** When the national listings were read (reused for 3 days). Absent on older checks. */
  searchedAt?: string;
  comparables: number;
  match: 'motorisation' | 'modele' | null;
};

export const AnalysesSchema = z.object({ analyses: z.array(AnalysisSchema) });

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
  /** Leboncoin account of the seller (absent on listings read before it was collected). */
  sellerId?: string | null;
  sellerName?: string | null;
  attributes: Record<string, string>;
}

export interface StoredAd extends Ad {
  searchLabel: string | null;
  /** Price when the listing was first collected. */
  firstPrice: number | null;
  comparison: import('./compare').Comparison | null;
  verification: Verification | null;
  sellerCheck: import('./seller').SellerCheck | null;
  /** What the seller's text says (from the listing bank, read once per listing). */
  facts?: import('./facts').Facts | null;
  /** When the message form to the seller was opened from the app. */
  contactedAt?: string | null;
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
  /** Start of the latest collection (same format as StoredAd.firstSeen); listings first seen since are new. */
  lastCollectAt: string | null;
}

/** The listing's current verdict: the check (made with the national comparison) wins over the first analysis. */
export function verdictOf(ad: StoredAd): { verdict: Verdict; score: number; verified: boolean } | null {
  if (ad.verification) return { verdict: ad.verification.verdict, score: ad.verification.score, verified: true };
  if (ad.analysis) return { verdict: ad.analysis.verdict, score: ad.analysis.score, verified: false };
  return null;
}

/** Answer to a follow-up question about one listing. */
export const AskAnswerSchema = z.object({ answer: z.string().describe('1 à 3 phrases courtes, ultra concises') });

/** A model the user adds to the hunt by name: its shortlist entry and its Leboncoin search. */
export const AddModelSchema = z.object({ pick: PickSchema, search: SearchSchema });
