import type { StoredAd } from './types';

const fold = (text: string) => text.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

/** Short first message: a few questions, the most telling first. */
const MAX_QUESTIONS = 4;
const MAX_SPECIFIC = 1;
const SIGNATURE = 'Michael';

/** "Le VIN ?" -> "le VIN ?" (keeps acronyms): the casual tone of the list. */
const casual = (q: string) => (/^[A-ZÀ-Ý][a-zà-ÿ’']/.test(q) ? q.charAt(0).toLowerCase() + q.slice(1) : q);

/**
 * Candidate questions in order of importance, worded as the user writes them. Each returns null
 * when the listing already settles it, and the words that make an AI question cover its topic.
 */
const TOPICS: { ask: (ad: StoredAd, text: string) => string | null; topic: RegExp }[] = [
  {
    // Several vehicles for sale: a hidden trader?
    ask: (ad) => {
      const others = ad.sellerCheck?.otherVehicles ?? 0;
      return others >= 1
        ? `vous vendez ${others === 1 ? 'deux voitures' : 'plusieurs voitures'} : vous les avez eues pour un usage ou une revente pro ?`
        : null;
    },
    topic: /pro\b|revente|marchand|professionnel/,
  },
  {
    // Costs ahead (a repair the text announces: its quote).
    ask: (ad, text) => {
      const repair = ad.facts?.repairs?.[0];
      if (repair) return `l’annonce parle de « ${repair} » : vous avez un devis ?`;
      if (/aucun frais|pas de frais|rien a prevoir|aucune? (reparation|travaux)/.test(text)) return null;
      return 'est-ce qu’il y aura prochainement des frais à prévoir (entretien, pièces d’usure…) ?';
    },
    topic: /frais|prevoir|reparation|travaux|devis|usure/,
  },
  {
    // History: the Autoviza report when Leboncoin shows its teaser, else the maintenance.
    ask: (ad, text) => {
      if (Object.keys(ad.attributes).some((k) => k.startsWith('vehicle_history_teaser'))) return 'vous avez le rapport Autoviza ?';
      const stated = ad.facts?.maintenance === 'complet' || /carnet d.entretien|toutes les factures|historique (complet|d.entretien)|entretien (suivi|a jour|complet)/.test(text);
      return stated ? null : 'l’entretien a-t-il été suivi en garage (factures) ?';
    },
    topic: /autoviza|historique|entretien|factures?|carnet|revision/,
  },
  {
    ask: (ad, text) => (ad.facts?.accident === 'aucun' || /(jamais|non|aucun|sans) (ete )?accident/.test(text) ? null : 'elle a déjà été accidentée ?'),
    topic: /accident|choc|sinistre/,
  },
];

/**
 * First message to the seller, short and in the user's tone: the most telling usual questions the
 * listing leaves open, plus the analysis' most useful question for this very listing.
 */
export function sellerMessage(ad: StoredAd): string {
  const text = fold(`${ad.title} ${ad.body}`);
  const asked = TOPICS.map((t) => ({ t, q: t.ask(ad, text) })).filter((x): x is { t: (typeof TOPICS)[number]; q: string } => x.q != null);
  const specific = (ad.analysis?.questions ?? [])
    .filter((q) => !asked.some((x) => x.t.topic.test(fold(q))))
    .slice(0, MAX_SPECIFIC)
    .map((q) => casual(q.trim().replace(/[?？.\s]*$/, '')) + ' ?');
  const usual = asked.map((x) => x.q).slice(0, Math.max(0, MAX_QUESTIONS - specific.length));
  const questions = [...usual, ...specific];

  return [
    'Bonjour,',
    '',
    questions.length
      ? 'Votre annonce m’intéresse. Si le véhicule est toujours disponible, j’aurais quelques questions :'
      : 'Votre annonce m’intéresse. Le véhicule est-il toujours disponible ?',
    ...(questions.length ? ['', ...questions.map((q) => `- ${q}`)] : []),
    '',
    'Merci à vous',
    '',
    'cdt',
    SIGNATURE,
  ].join('\n');
}
