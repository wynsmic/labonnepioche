import type { z } from 'zod';
import {
  AnalysesSchema,
  PlanSchema,
  PricePointsSchema,
  AskAnswerSchema,
  AddModelSchema,
  VerificationSchema,
  type Ad,
  type Analysis,
  type Plan,
} from '../contracts/types';
import { ageInDays, numberFrom, type Comparison } from './domain/compare';
import { ageFrom, describeCurve, kmFrom, project } from './domain/pricing';
import { FactsListSchema, type Facts } from './domain/facts';
import type { Estimate } from './domain/estimate';
import type { SellerCheck } from './domain/seller';
import { llm, type Env } from './llm';

const PREPARE_SYSTEM = `Tu aides un particulier à dénicher de vraies bonnes affaires sur Leboncoin (France).
On te donne sa demande et une recherche déjà faite sur le web.
Principe : on ne garde QUE des choix réellement bons. Il ne s'agit pas d'éviter les mauvais, mais de ne
retenir que ce qui est recommandable pour la demande, sans en oublier : un choix fiable mais moins demandé
est souvent là où se cachent les pépites. Construis la shortlist (autant de choix que la demande en justifie, versions précises, niveau
excellent ou très bon), puis des critères, puis des recherches Leboncoin qui ne ciblent que ces choix
(une par choix, fourchettes de prix et de kilométrage cohérentes avec leur prix de marché).
Mots obligatoires (required_groups) : la recherche Leboncoin reste large (marque et modèle) ; c'est ici que tu
imposes la version de la shortlist (carrosserie, motorisation), avec les synonymes que les vendeurs écrivent
vraiment (« sw », « break », « touring » ; « hybride », « hybrid », « hsd »…). Uniquement carrosserie et
carburant / type de motorisation : jamais de cylindrée ni de puissance (souvent absentes des annonces, ce
serait écarter de bonnes affaires) ; la version précise se vérifie à l'analyse.
Mots d'exclusion : seulement ce qui dit que l'objet est hors d'usage, jamais la situation du vendeur
(urgent, pressé, départ, déménagement : ce sont des occasions d'affaires).
Pour chaque choix, garde ce qui aide à le reconnaître et à le comparer : une phrase-mémo (tagline), quelques
repères chiffrés ou distinctifs vraiment utiles (consommation réelle, volume de coffre, distribution, boîte,
autonomie…) et les finitions courantes avec ce qu'elles valent. Chaque recherche nomme le choix qu'elle cible.
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
distille l'annonce en une phrase courte, puis les points forts, les signaux d'alerte et les questions à
poser au vendeur en listes courtes (3 éléments au plus chacune). Points forts et alertes en style
télégraphique ; questions polies, comme écrites au vendeur, et propres à l'annonce (les questions
habituelles sur les frais, le CT, l'import, les accidents et l'entretien sont déjà posées).
Sois concret et sceptique. Réponds en français.
Fraîcheur (champ en_ligne_depuis_jours) : une vraie pépite part en quelques heures ou quelques jours.
- Plus de 3 jours en ligne avec un prix très bas : jamais « pepite » ; c'est un signal d'alerte
  (défaut caché, prix d'appel, arnaque ou annonce déjà vendue) à mentionner dans red_flags.
- Plus de 14 jours : le marché l'a probablement jugée trop chère ou problématique ; dis-le.
Prix attendu (champ prix_attendu, quand il existe) : courbe de prix du modèle (ajustée sur les annonces de
France après analyse, sinon pressentie à partir des prix de marché du plan) à l'âge et au kilométrage de
l'annonce, corrigée de ce que dit le texte (accident, état, réparations, options : détail dans « calcul »).
C'est ta référence de marché principale : ne recompte pas ce qui y est déjà ; corrige seulement ce qu'elle ne
voit pas (version exacte, finition) et dis-le. Sans ce champ, estime le marché toi-même.
Prix : donne toujours market_price (valeur de marché de CETTE annonce) et, pour un véhicule, new_price
(prix catalogue neuf de la version à son année, options courantes), même approximatifs.
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

export async function analyseAds(
  env: Env,
  prompt: string,
  plan: Plan | null,
  ads: Ad[],
  estimates: Map<string, Estimate> = new Map(),
): Promise<Analysis[]> {
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
    user: `Annonces à juger :\n${JSON.stringify(
      ads.map((ad) => {
        const e = estimates.get(ad.id);
        return {
          ...compactAd(ad),
          prix_attendu: e
            ? {
                prix: e.expected,
                fourchette: [e.low, e.high],
                ecart_pct: -e.discount,
                base:
                  e.basis === 'marche'
                    ? `courbe ajustée sur ${e.peers} annonces en France`
                    : e.basis === 'local'
                      ? `niveau mesuré sur ${e.peers} annonces collectées`
                      : e.basis === 'ia'
                        ? 'courbe pressentie (prix de marché du plan)'
                        : 'prix estimé de l’annonce',
                calcul: e.factors,
              }
            : null,
        };
      }),
    )}`,
    effort: 'medium',
  });
  const wanted = new Set(ads.map((a) => a.id));
  return result.analyses.filter((a) => wanted.has(a.id));
}

const VERIFY_SYSTEM = `Tu vérifies UNE annonce Leboncoin qui semble être une bonne affaire, pour un particulier.
On te donne sa demande, la shortlist des seuls choix acceptés, l'annonce, son prix attendu, et le marché France
de son modèle : une courbe de prix ajustée sur les annonces de particuliers du même modèle (même motorisation
quand le champ « niveau » vaut « motorisation »), qui donne le prix d'un exemplaire courant à l'âge et au
kilométrage de l'annonce (« mediane ») et la fourchette où se situe la moitié du marché. Le prix attendu y
ajoute ce que dit le texte de l'annonce (accident, état, réparations, options : détail dans « calcul »).
Les annonces comparables gardent leur prix affiché et leur prix ramené à l'annonce. Raisonne sur ces prix.
Juge à nouveau l'annonce avec ce contexte :
- Le prix : écart à la médiane et à la fourchette habituelle, en tenant compte du kilométrage, de l'année,
  de l'équipement et de l'état décrit, comparés aux annonces similaires.
- La crédibilité : un prix très en dessous de tout le marché, une annonce en ligne depuis plus de 3 jours
  à un prix très bas, une description vague ou des signes d'arnaque font pencher vers « suspect ».
- La conformité : hors shortlist (modèle, motorisation, années) = hors_sujet.
- Le vendeur (quand son profil est fourni) : compte très récent, compte neuf avec une seule annonce très
  sous le marché, ou plusieurs véhicules en vente (marchand non déclaré) rendent une affaire suspecte.
- Pas assez d'annonces comparables : juge avec ton estimation du marché et dis-le dans le détail.
Verdicts : pepite (exceptionnelle et crédible), bonne_affaire, correct, cher, suspect, hors_sujet.
L'écart de prix est déjà affiché à côté de ton verdict : la cause dit ce qui l'explique au-delà du prix
(3 à 6 mots) ; le détail cite les chiffres utiles. Sois sceptique. Réponds en français.`;

function compactComparable(ad: Ad) {
  return {
    titre: ad.title,
    prix: ad.price,
    km: numberFrom(ad.attributes.mileage),
    annee: numberFrom(ad.attributes.regdate),
    ville: ad.city,
    en_ligne_depuis_jours: (() => {
      const days = ageInDays(ad.date);
      return days == null ? null : Math.round(days);
    })(),
    description: ad.body.slice(0, 200),
  };
}

export async function verifyAd(
  env: Env,
  prompt: string,
  plan: Plan | null,
  ad: Ad,
  comparison: Comparison | null,
  comparablesList: Ad[],
  seller: SellerCheck | null = null,
  estimate: Estimate | null = null,
): Promise<z.infer<typeof VerificationSchema>> {
  if (env.MOCK_AI === '1') {
    const m = mockAnalysis(ad);
    return { verdict: m.verdict, score: m.score, cause: 'Exemple hors ligne', detail: 'Réponse d’exemple (MOCK_AI=1).' };
  }
  const market = comparison
    ? {
        niveau: comparison.match,
        motorisation_lue: comparison.engine,
        annonces: comparison.count,
        mediane: comparison.median,
        fourchette_habituelle: [comparison.p25, comparison.p75],
        min: comparison.min,
        max: comparison.max,
        part_plus_cheres_que_cette_annonce_pct: comparison.cheaperThan,
        prix_ramenes_a: comparison.adjustedTo ?? null,
        loi_de_decote: comparison.curve && 'alpha' in comparison.curve ? describeCurve(comparison.curve) : 'ancienne loi',
        km_median: comparison.medianMileage,
        annee_mediane: comparison.medianYear,
      }
    : null;
  // Closest in price first: the ones that tell most about this listing.
  const sample = [...comparablesList]
    .sort((x, y) => Math.abs((x.price ?? 0) - (ad.price ?? 0)) - Math.abs((y.price ?? 0) - (ad.price ?? 0)))
    .slice(0, 25)
    .map((c) => ({
      ...compactComparable(c),
      prix_ramene: (() => {
        const curve = comparison?.curve;
        const from = ageFrom(c.attributes);
        const to = ageFrom(ad.attributes);
        if (!curve || !('alpha' in curve) || c.price == null || from == null || to == null) return null;
        return Math.round(project(curve, c.price, { age: from, km: kmFrom(c.attributes) }, { age: to, km: kmFrom(ad.attributes) }));
      })(),
    }));
  return llm(env).structured(VerificationSchema, {
    system: VERIFY_SYSTEM,
    user: [
      `Demande :\n${prompt}`,
      plan ? `Shortlist :\n${formatShortlist(plan)}` : '',
      `Annonce à vérifier :\n${JSON.stringify(compactAd(ad))}`,
      estimate
        ? `Prix attendu de cette annonce :\n${JSON.stringify({ prix: estimate.expected, fourchette: [estimate.low, estimate.high], ecart_pct: -estimate.discount, calcul: estimate.factors })}`
        : '',
      market
        ? `Marché France :\n${JSON.stringify(market)}\n\nAnnonces comparables (les plus proches en prix) :\n${JSON.stringify(sample)}`
        : 'Marché France : pas assez d’annonces comparables trouvées.',
      seller
        ? `Profil du vendeur (lu sur Leboncoin) :\n${JSON.stringify({
            membre_depuis: seller.memberSince,
            anciennete_jours: seller.accountAgeDays,
            annonces_en_ligne: seller.totalAds,
            autres_vehicules_en_vente: seller.otherVehicles,
            verifications: seller.badges,
            alertes: seller.flags,
          })}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
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
        tagline: 'Citadine increvable, peu chère à entretenir',
        tags: ['5 l/100 km', 'coffre 286 l', 'chaîne de distribution'],
        trims: [
          { name: 'Dynamic', note: 'milieu de gamme, clim et Bluetooth' },
          { name: 'Design', note: 'haut de gamme, caméra et jantes alu' },
        ],
      },
    ],
    research: `**Exemple hors ligne** pour : ${prompt.slice(0, 80)}\n\nToyota Yaris/Corolla hybrides et Honda Jazz sont réputées fiables.`,
    criteria: ['Entretien suivi', 'Moins de 150 000 km', 'Prix sous la cote'],
    searches: [
      {
        label: 'Yaris hybride récente',
        pick: 'Toyota Yaris III',
        why: 'Fiable, consommation faible',
        category: 2,
        text: 'yaris hybride',
        price_min: 6000,
        price_max: 12000,
        mileage_min: null,
        mileage_max: 120000,
        regdate_min: 2014,
        regdate_max: null,
        required_groups: [],
        exclude_keywords: ['pour pièces', 'moteur hs'],
      },
      {
        label: 'Honda Jazz économique',
        pick: 'Toyota Yaris III',
        why: 'Très robuste, prix bas',
        category: 2,
        text: 'honda jazz',
        price_min: null,
        price_max: 7000,
        mileage_min: null,
        mileage_max: 160000,
        regdate_min: 2010,
        regdate_max: null,
        required_groups: [],
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
    new_price: ad.price ? Math.round(ad.price * 2.2) : null,
    summary: `Exemple hors ligne : ${ad.title}.`,
    positives: ['Annonce détaillée'],
    red_flags: score < 30 ? ['Prix au-dessus du marché'] : [],
    questions: ['Factures d’entretien disponibles ?'],
  };
}

const FACTS_SYSTEM = `Tu lis des annonces de voitures d'occasion (Leboncoin) et tu en extrais des faits, pour chaque annonce
séparément. N'utilise QUE le texte et les caractéristiques de l'annonce concernée : jamais ce qui est écrit dans
une autre annonce. Ce qui n'est pas dit vaut « inconnu », null ou [].
- accident : « jamais accidenté » = aucun ; choc, carrosserie, pare-chocs réparés = leger ; structure, châssis,
  airbags déclenchés, VGE, VEI, véhicule gravement endommagé réparé = lourd.
- mileage_doubt : kilométrage incohérent avec l'âge (ex. 250 km pour une voiture de 8 ans, sans doute 250 000),
  ou contredit par le texte.
- adjust_pct : effet sur le prix par rapport à un exemplaire courant de même âge et kilométrage, de l'état, des
  options, des défauts d'aspect, des réparations à prévoir (au prix d'un garage), de l'entretien, du CT et du
  nombre de propriétaires. Ordres de grandeur : carnet complet et première main +3 à +6 ; équipement riche +2
  à +6 ; rayures ou petits chocs −2 à −5 ; pneus ou freins à faire −2 à −4 ; embrayage, distribution, boîte ou
  turbo à prévoir −8 à −20 ; voyant moteur ou bruit inexpliqué −10 à −25. N'y compte NI l'accident (traité à
  part), NI l'âge, NI le kilométrage. Rien de notable : 0.
Réponds en français, une entrée par annonce reçue, avec son id.`;

/** Facts read in the sellers' texts, for a batch of listings (small model, one call). */
export async function extractFacts(env: Env, ads: Ad[]): Promise<Facts[]> {
  if (!ads.length) return [];
  if (env.MOCK_AI === '1') {
    return ads.map((ad) => ({
      id: ad.id, accident: 'inconnu', owners: null, mileage_doubt: false, condition: 'inconnu', repairs: [], cosmetic: [],
      maintenance: 'inconnu', ct: 'inconnu', equipment: 'inconnu', adjust_pct: 0, adjust_reason: 'exemple hors ligne',
    }));
  }
  const result = await llm(env).structured(FactsListSchema, {
    system: FACTS_SYSTEM,
    user: JSON.stringify(
      ads.map((ad) => ({
        id: ad.id,
        titre: ad.title,
        caracteristiques: Object.fromEntries(
          Object.entries(ad.attributes).filter(([k]) => !/url|picture|payment|eligible|licence|teaser_critair|argus|car_price/.test(k)),
        ),
        description: ad.body.length > 3000 ? `${ad.body.slice(0, 3000)}…` : ad.body,
      })),
    ),
    effort: 'low',
    small: true,
  });
  const wanted = new Set(ads.map((a) => a.id));
  return result.facts.filter((f) => wanted.has(f.id));
}

const PRICE_POINTS_SYSTEM = `Tu connais le marché français de la voiture d'occasion entre particuliers.
Pour chaque modèle de la liste (versions et années données), donne 4 à 6 prix de marché constatés pour un
exemplaire courant en bon état, à des années différentes qui couvrent les années retenues (et un an ou deux
de part et d'autre), chacun avec son kilométrage typique (≈ 13 000 km par an). Ces points donnent la courbe
de prix du modèle avant toute analyse d'annonces : sois réaliste (prix de transaction, pas de vitrine pro).
Reprends le nom exact de chaque modèle.`;

/** Market price points of each shortlist choice (separate light call: the plan call is already heavy). */
export async function pricePoints(env: Env, plan: Plan): Promise<Plan> {
  const shortlist = plan.shortlist ?? [];
  if (!shortlist.length) return plan;
  if (env.MOCK_AI === '1') {
    const year = new Date().getFullYear();
    return {
      ...plan,
      shortlist: shortlist.map((p) => ({ ...p, price_points: [8, 6, 4, 2].map((age) => ({ year: year - age, km: 13000 * age, price: Math.round(25000 * Math.pow(1 + age, -0.36)) })) })),
    };
  }
  const result = await llm(env).structured(PricePointsSchema, {
    system: PRICE_POINTS_SYSTEM,
    user: `Modèles :\n${shortlist.map((p) => `- ${p.name} — versions ${p.versions.join(', ')} — années ${p.years} — repère ${p.fair_price}`).join('\n')}\n\nContexte (recherche déjà faite) :\n${plan.research}`,
    effort: 'low',
  });
  const fold = (t: string) => t.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const byName = new Map(result.models.map((m) => [fold(m.name), m.price_points]));
  // The model sometimes rewords a name: same position in the list then (answers follow the order asked).
  return {
    ...plan,
    shortlist: shortlist.map((p, i) => ({
      ...p,
      price_points: byName.get(fold(p.name)) ?? (result.models.length === shortlist.length ? result.models[i].price_points : []),
    })),
  };
}

const ASK_SYSTEM = `Tu aides un particulier qui étudie UNE annonce de voiture d'occasion (Leboncoin) pour savoir si c'est une
bonne affaire. On te donne l'annonce (texte du vendeur compris), l'analyse déjà faite, les faits lus dans le texte,
le prix attendu et son calcul. Réponds à sa question en français, de façon ultra concise : 1 à 3 phrases courtes,
chiffres précis quand c'est utile, pas de formule de politesse ni de reformulation de la question. Si l'annonce ne
permet pas de répondre, dis-le et dis quoi demander au vendeur. Ne réinvente pas ce qui n'est pas dans les données
quand la question porte sur cette voiture ; tes connaissances générales (fiabilité, pannes connues, coûts) sont
bienvenues quand la question est générale.`;

/** A follow-up question about one listing, answered in a few words with everything known about it. */
export async function askAboutAd(
  env: Env,
  prompt: string,
  ad: Ad,
  known: { analysis: unknown; verification: unknown; facts: unknown; estimate: Estimate | null; comparison: Comparison | null },
  history: { q: string; a: string }[],
  question: string,
): Promise<string> {
  if (env.MOCK_AI === '1') return 'Réponse d’exemple (MOCK_AI=1).';
  const result = await llm(env).structured(AskAnswerSchema, {
    system: ASK_SYSTEM,
    context: [
      `Demande de l'acheteur :\n${prompt}`,
      `Annonce :\n${JSON.stringify({ ...compactAd(ad), description: ad.body.slice(0, 4000) })}`,
      `Analyse :\n${JSON.stringify(known.analysis ?? null)}`,
      known.verification ? `Vérification du prix :\n${JSON.stringify(known.verification)}` : '',
      known.facts ? `Faits lus dans le texte :\n${JSON.stringify(known.facts)}` : '',
      known.estimate
        ? `Prix attendu :\n${JSON.stringify({ prix: known.estimate.expected, fourchette: [known.estimate.low, known.estimate.high], ecart_pct: -known.estimate.discount, calcul: known.estimate.factors })}`
        : '',
      known.comparison ? `Marché France : ${known.comparison.count} annonces, exemplaire courant ${known.comparison.median} €` : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
    user: [...history.map((h) => `Question : ${h.q}\nRéponse : ${h.a}`), `Question : ${question}`].join('\n\n'),
    effort: 'low',
  });
  return result.answer.trim();
}

const ADD_MODEL_SYSTEM = `${PREPARE_SYSTEM}
Ici, l'utilisateur ajoute lui-même UN modèle à sa recherche : décris ce choix comme ceux de la shortlist (versions
précises les plus recommandables pour sa demande, années, pourquoi, prix de marché, mémo, repères, finitions) et
donne UNE recherche Leboncoin qui le cible, cohérente avec les autres recherches du plan (mêmes logiques de prix,
kilométrage, mots obligatoires et exclusions). Garde son nom tel que l'utilisateur le comprend.`;

/** A model the user names, turned into a shortlist choice and its search, with its price points. */
export async function addModel(env: Env, prompt: string, plan: Plan, name: string): Promise<Plan> {
  const result =
    env.MOCK_AI === '1'
      ? { pick: { ...plan.shortlist[0], name }, search: { ...plan.searches[0], label: name, pick: name, text: name.toLowerCase() } }
      : await llm(env).structured(AddModelSchema, {
          system: ADD_MODEL_SYSTEM,
          user: [
            `Ma demande :\n${prompt}`,
            `Plan actuel (shortlist) :\n${formatShortlist(plan)}`,
            `Recherches actuelles :\n${JSON.stringify(plan.searches.map((s) => ({ label: s.label, text: s.text, prix: [s.price_min, s.price_max], km_max: s.mileage_max, annees: [s.regdate_min, s.regdate_max] })))}`,
            `Modèle à ajouter : ${name}`,
          ].join('\n\n'),
          effort: 'medium',
        });
  const pick = { ...result.pick, name: result.pick.name || name };
  const search = { ...result.search, pick: pick.name };
  // Price points of the new choice only (separate light call).
  let priced = pick as Plan['shortlist'][number];
  try {
    priced = (await pricePoints(env, { ...plan, shortlist: [pick] })).shortlist[0];
  } catch (err) {
    console.error('price points', err);
  }
  return { ...plan, shortlist: [...plan.shortlist, priced], searches: [...plan.searches, search] };
}
