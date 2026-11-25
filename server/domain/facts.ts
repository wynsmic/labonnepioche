import { z } from 'zod';
import { FactsSchema, type Facts } from '../../contracts/types';

export { FactsSchema, type Facts };

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
