import { z } from 'zod';

/**
 * What the seller's text says that moves the price, read once per listing by a small model and
 * kept in the listing bank (shared by every hunt) for 15 days.
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
export const FactsListSchema = z.object({ facts: z.array(FactsSchema) });

/**
 * Accident: the one coefficient kept as a rule (sourced). French expertise and buy-back sites put a
 * repaired light knock at −5 to −15 % and heavy structural damage at −25 to −40 % of the value,
 * even after a careful repair: the middle of each range.
 */
export const ACCIDENT_FACTOR = { aucun: 1, inconnu: 1, leger: 0.9, lourd: 0.7 } as const;
export const ADJUST_BOUNDS = [-35, 12] as const;

/** Multiplier of the market price for what the text says, with its explanation lines. */
export function factsFactor(facts: Facts | null | undefined): { factor: number; lines: string[] } {
  if (!facts) return { factor: 1, lines: [] };
  const lines: string[] = [];
  const accident = ACCIDENT_FACTOR[facts.accident] ?? 1;
  if (accident !== 1) lines.push(`Accident ${facts.accident === 'lourd' ? 'grave' : 'léger'} déclaré : −${Math.round((1 - accident) * 100)} %`);
  const adjust = Math.min(ADJUST_BOUNDS[1], Math.max(ADJUST_BOUNDS[0], facts.adjust_pct)) / 100;
  if (Math.round(adjust * 100) !== 0) {
    lines.push(`État et contenu de l’annonce (IA) : ${adjust > 0 ? '+' : '−'}${Math.abs(Math.round(adjust * 100))} %${facts.adjust_reason ? ` (${facts.adjust_reason})` : ''}`);
  }
  if (facts.mileage_doubt) lines.push('Kilométrage douteux : à faire confirmer');
  return { factor: accident * (1 + adjust), lines };
}
