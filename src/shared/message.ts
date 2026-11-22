import type { StoredAd } from './types';

const fold = (text: string) => text.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

/**
 * The usual questions to a seller, each with what in the listing already answers it (then it is
 * not asked) and the words that tell an AI question covers the same topic (then it is not doubled).
 */
const BASE: { question: string; answered: RegExp; topic: RegExp }[] = [
  {
    question: 'S’il y a des frais à prévoir ?',
    answered: /aucun frais|pas de frais|rien a prevoir|aucune? (reparation|travaux)/,
    topic: /frais|prevoir|reparation|travaux/,
  },
  {
    question: 'Si le contrôle technique est bon ou s’il comporte des réserves ?',
    answered: /\b(ct|controle technique) (ok|vierge|sans (defaut|reserve)|r?e?c?e?n?t? ?fait|a jour)/,
    topic: /\bct\b|controle technique/,
  },
  {
    question: 'Si le véhicule est d’origine française ou importé ?',
    answered: /origine francaise|francaise d.origine|vehicule francais|non importe|pas d.import/,
    topic: /import|origine/,
  },
  {
    question: 'S’il a déjà été accidenté ?',
    answered: /(jamais|non|aucun|sans) (ete )?accident/,
    topic: /accident|choc|sinistre/,
  },
  {
    question: 'Si l’historique d’entretien est disponible ?',
    answered: /carnet d.entretien|toutes les factures|historique (complet|d.entretien)|entretien (suivi|a jour|complet)/,
    topic: /entretien|factures?|carnet|historique|revision/,
  },
];

/**
 * First message to the seller: the usual questions minus those the listing already answers,
 * plus the questions the analysis raised for this very listing (not doubling a topic).
 */
export function sellerMessage(ad: StoredAd): string {
  const text = fold(`${ad.title} ${ad.body}`);
  const kept = BASE.filter((b) => !b.answered.test(text));
  const specific = (ad.analysis?.questions ?? [])
    .filter((q) => !kept.some((b) => b.topic.test(fold(q))))
    .slice(0, 3)
    .map((q) => (/[?？]\s*$/.test(q) ? q : `${q} ?`));

  const questions = [
    ...kept.map((b) => b.question),
    ...specific,
    'Où peut-on voir le véhicule et comment préférez-vous procéder pour la transaction si tout est en ordre ?',
  ];

  return [
    'Bonjour,',
    '',
    `Votre annonce « ${ad.title.trim()} » m’intéresse. Le véhicule est-il toujours disponible ?`,
    '',
    'J’aurais quelques questions si vous avez quelques minutes :',
    '',
    ...questions.map((q) => `- ${q}`),
    '',
    'J’ai de la bonne disponibilité en ce moment donc je peux me caler sur vous pour tout éventuel rendez-vous.',
    '',
    'Bonne journée à vous',
  ].join('\n');
}
