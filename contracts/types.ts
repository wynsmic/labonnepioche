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
  comparison: Comparison | null;
  verification: Verification | null;
  sellerCheck: SellerCheck | null;
  /** What the seller's text says (from the listing bank, read once per listing). */
  facts?: Facts | null;
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
  /** Also collect professional sellers' listings (default: private sellers only). */
  includePros: boolean;
}

/** Answer to a follow-up question about one listing. */
export const AskAnswerSchema = z.object({ answer: z.string().describe('1 à 3 phrases courtes, ultra concises') });

/** A model the user adds to the hunt by name: its shortlist entry and its Leboncoin search. */
export const AddModelSchema = z.object({ pick: PickSchema, search: SearchSchema });

// --- Data shapes computed by the server ---

/**
 * What the seller's text says that moves the price, read once per listing by a small model and
 * kept in the listing bank (shared by every hunt) for 30 days.
 */
export const FactsSchema = z.object({
  id: z.string(),
  accident: z
    .enum(['aucun', 'leger', 'lourd', 'inconnu'])
    .describe('aucun = le vendeur dit jamais accidenté ; leger = choc ou carrosserie réparés ; lourd = structure, airbags, VGE/VEI, épave réparée ; inconnu = rien n’est dit'),
  owners: z.number().int().nullable().describe('Nombre de propriétaires (« 1re main » = 1), null si non dit'),
  mileage_doubt: z.boolean().describe('Kilométrage douteux : incohérent avec l’âge, ou écrit en milliers (« 250 km » pour 250 000)'),
  condition: z.enum(['excellent', 'bon', 'moyen', 'mauvais', 'inconnu']),
  repairs: z.array(z.string()).describe('Réparations ou pièces à prévoir, 4 mots max chacune (« embrayage à changer »), [] si rien'),
  cosmetic: z.array(z.string()).describe('Défauts d’aspect (rayures, bosses, jantes), 4 mots max chacun, [] si rien'),
  maintenance: z.enum(['complet', 'partiel', 'inconnu']).describe('complet = carnet ou factures complètes'),
  ct: z.enum(['ok', 'defauts', 'a_faire', 'inconnu']),
  equipment: z.enum(['base', 'courant', 'riche', 'inconnu']).describe('Niveau d’équipement et d’options par rapport à la version'),
  adjust_pct: z
    .number()
    .describe(
      'Effet sur le prix, en %, de l’état, des options, des défauts, des réparations à prévoir, de l’entretien, du CT et du nombre de propriétaires, par rapport à un exemplaire courant de même âge et kilométrage. SANS l’accident (compté à part), SANS l’âge ni le kilométrage. Entre -35 et +12',
    ),
  adjust_reason: z.string().describe('Ce qui fait cet effet, 10 mots max (« embrayage à prévoir, carnet complet »)'),
});
export type Facts = z.infer<typeof FactsSchema>;

/** Price curve of a model: ln P = c − α·ln(1 + age) − β·(km gap to the usual mileage for the age). */
export interface PriceCurve {
  c: number;
  alpha: number;
  beta: number;
  /** Robust standard deviation of log prices around the curve. */
  spread: number;
  /**
   * ia = the AI's price points alone; local = level measured on the listings already collected
   * (hunt area), shape from the AI; marche = fitted on the model's national listings.
   */
  source: 'ia' | 'local' | 'marche';
  /** Listings used for the fit (0 for an AI curve). */
  n: number;
  /** Slopes learnt from the data, or kept from the prior (small or narrow sample). */
  slopes: 'donnees' | 'a-priori';
  /** Years covered by the listings used. */
  years?: [number, number];
  fittedAt?: string;
}

/** How a listing compares with very similar ones across France. */
export interface Comparison {
  at: string;
  /** Leboncoin search used (national, no area). */
  query: Search;
  count: number;
  median: number;
  p25: number;
  p75: number;
  min: number;
  max: number;
  /** Share of comparable listings that cost more than this one (0–100). */
  cheaperThan: number;
  medianMileage: number | null;
  medianYear: number | null;
  /** "motorisation": only listings with the same engine; "modele": same model, fuel and gearbox. */
  match: 'motorisation' | 'modele';
  /** Engine of the checked listing as read from its text, e.g. "1.5 dci 110 ch". */
  engine: string | null;
  /**
   * Prices are brought to this listing's year and mileage with the depreciation law (absent on
   * comparisons saved before that existed: raw prices then).
   */
  adjustedTo?: { year: number | null; km: number | null };
  /** Price curve of the model fitted on these listings (older comparisons: a log-linear law). */
  curve?: PriceCurve | { perYear: number; per10kKm: number };
  /** Sorted prices (adjusted), for the strip chart. */
  prices: number[];
  /** The cheapest comparable listings, for a look. */
  cheapest: { title: string; price: number; adjusted?: number; mileage: number | null; year: number | null; city: string | null; url: string }[];
}

/** Seller's public profile, judged. */
export interface SellerCheck {
  at: string;
  profileUrl: string;
  memberSince: string | null;
  accountAgeDays: number | null;
  totalAds: number | null;
  /** Other vehicles the seller has for sale. */
  otherVehicles: number;
  badges: string[];
  level: 'ok' | 'attention' | 'suspect';
  flags: string[];
}

/** Market reference of a listing: expected price, range, source, gap (computed by the server). */
export interface Estimate {
  /** Positive = cheaper than expected (12 means 12 % under). */
  discount: number;
  expected: number;
  /** Likely market range for this very listing (middle half of comparable listings). */
  low: number;
  high: number;
  /**
   * marche = curve fitted on the model's listings across France; local = level measured on the
   * listings already collected, AI curve shape; ia = the AI's price points alone; annonce = AI
   * price of this listing alone (no curve).
   */
  basis: 'marche' | 'local' | 'ia' | 'annonce';
  /** Listings behind the curve (marche only). */
  peers: number;
  /** What made the expected price, for the detail. */
  factors: string[];
}

/** One spec under the photo (year, mileage, engine, gearbox), ready to show. */
export interface Fact {
  label: string;
  value: string;
  /** Short context shown under the value ("hors 2019–2022"). */
  hint?: string;
  tone?: 'good' | 'warn';
}

// --- API view of a listing: everything the page shows, computed by the server ---

export type Tone = 'good' | 'neutral' | 'bad' | 'warn' | 'none';

export interface AdView {
  /** Current verdict: the price check wins over the first analysis. */
  verdict: { verdict: Verdict; score: number; verified: boolean } | null;
  estimate: Estimate | null;
  /** Colour of the price gap: green under the market, red above, amber on a suspect listing. */
  tone: Tone;
  /** The shortlist choice the listing belongs to, and its trim. */
  model: { name: string; tagline: string | null; tags: string[] } | null;
  trim: { name: string; note: string | null } | null;
  specs: Fact[];
  year: number | null;
  mileage: number | null;
  /** The AI says the listing is off the shortlist. */
  offTopic: boolean;
  /** Not a deal: Leboncoin rates the price fair or higher (or, without its rating, our verdict says « correct » / « cher »). */
  notADeal: boolean;
  /** Far enough under the market for its seller to be checked. */
  striking: boolean;
  /** The seller line shows a warning (striking deal or suspect listing). */
  sellerFlag: boolean;
  /** First message to the seller. */
  message: string;
  /** Comparables search used for « Analyser le prix » (saved one, else the default wide search). */
  compareQuery: Search;
  /** Leboncoin link of that national search. */
  nationalUrl: string | null;
  /** How the comparables were brought to this listing's age and mileage, in words. */
  curveText: string | null;
  sellerProfileUrl: string | null;
  /** First seen by the latest « Récupérer les annonces ». */
  isNew: boolean;
}

export interface ViewedAd extends StoredAd {
  view: AdView;
}

/** GET /briefs/:id */
export interface BriefDetail {
  brief: Brief;
  versions: { id: string; prompt: string; note: string | null; createdAt: string }[];
  plan: { plan: Plan; createdAt: string } | null;
  ads: ViewedAd[];
  pending: number;
  /** The area as searched, in words (« Rennes 30 km, Saint-Malo 30 km »). */
  zoneSummary: string;
  /** Leboncoin pages to read for each planned search (same order as plan.searches). */
  searchPages: string[][];
  /** A listing this far under its market (in %) gets its seller checked. */
  sellerCheckDiscount: number;
}

/** The price analysis needs a national search the bank lacks: the page reads these pages and calls again. */
export interface NeedCandidates {
  needCandidates: true;
  urls: string[];
  pauseMs: [number, number];
}
