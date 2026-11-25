import { factsFactor, type Facts } from './facts';
import { pickOf } from './models';
import { ageFrom, curveFromPoints, describeCurve, kmFrom, predict, range, type PriceCurve } from './pricing';
import type { Ad, Estimate, Plan, StoredAd } from '../../contracts/types';

export type { Estimate };

/**
 * Expected market price of a listing and its gap to the asking price:
 *   curve of its model (fitted on national listings after « Analyser le prix », else the AI's
 *   price points of the plan) at its age and mileage
 *   × what its text says (accident rule, AI reading of condition, options, repairs…).
 * Without any curve, the AI's market price of the listing itself (first analysis) is the fallback.
 */

export interface PriceInputs {
  curve: PriceCurve | null;
  facts: Facts | null;
  /** AI market price of the listing (first analysis), last resort. */
  aiMarket: number | null;
}

const int = new Intl.NumberFormat('fr-FR');
const euros = (v: number) => `${int.format(Math.round(v / 50) * 50)} €`;

const fold = (text: string | undefined) =>
  (text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** One curve per model reference: make, model and fuel as Leboncoin states them. */
export function curveKey(ad: Ad): string | null {
  const brand = fold(ad.attributes.brand ?? ad.attributes.u_car_brand);
  const model = fold(ad.attributes.model ?? ad.attributes.u_car_model);
  if (!brand || !model) return null;
  return `${brand}|${model}|${fold(ad.attributes.fuel)}`;
}

/** The AI curve of a shortlist choice, from its price points (memoised per plan). */
const aiCurves = new WeakMap<object, Map<string, PriceCurve | null>>();
export function aiCurveOf(plan: Plan | null | undefined, ad: Ad, now = Date.now()): PriceCurve | null {
  const pick = pickOf(plan, ad);
  const points = (pick as { price_points?: { year: number; km: number; price: number }[] } | null)?.price_points;
  if (!plan || !pick || !points?.length) return null;
  let cache = aiCurves.get(plan);
  if (!cache) aiCurves.set(plan, (cache = new Map()));
  if (!cache.has(pick.name)) {
    const year = new Date(now).getFullYear();
    cache.set(pick.name, curveFromPoints(points.map((p) => ({ age: Math.max(0, year - p.year + 0.5), km: p.km, price: p.price }))));
  }
  return cache.get(pick.name) ?? null;
}

/** Inputs of the estimate: the market curve of the model when fitted, else the AI's. */
export function priceInputs(ad: StoredAd, plan: Plan | null | undefined, curves: Record<string, PriceCurve>): PriceInputs {
  const key = curveKey(ad);
  return {
    curve: (key && curves[key]) || aiCurveOf(plan, ad),
    facts: ad.facts ?? null,
    aiMarket: ad.analysis?.market_price ?? null,
  };
}

export function estimateOf(ad: Ad, inputs: PriceInputs, now = Date.now()): Estimate | null {
  if (ad.price == null) return null;
  const age = ageFrom(ad.attributes, now);
  const km = kmFrom(ad.attributes);
  const { factor, lines } = factsFactor(inputs.facts);
  const factors: string[] = [];
  let expected: number;
  let spread: number;
  let basis: Estimate['basis'];
  let peers = 0;

  if (inputs.curve && age != null) {
    const c = inputs.curve;
    const typical = predict(c, age, km);
    expected = typical * factor;
    spread = c.spread;
    basis = c.source;
    peers = c.n;
    factors.push(
      c.source === 'marche'
        ? `Courbe du modèle ajustée sur ${c.n} annonces en France${c.years ? ` (${c.years[0]}–${c.years[1]})` : ''}${c.slopes === 'a-priori' ? ', pente de décote standard (échantillon trop étroit)' : ''}`
        : c.source === 'local'
          ? `Niveau mesuré sur ${c.n} annonces du modèle déjà collectées, forme de courbe de l’IA (avant l’analyse France)`
          : 'Courbe pressentie par l’IA (prix de marché du modèle), avant l’analyse France',
    );
    factors.push(`Décote : ${describeCurve(c)}`);
    factors.push(`Exemplaire courant de cet âge et de ce kilométrage : ${euros(typical)}`);
    factors.push(...lines);
  } else if (inputs.aiMarket) {
    // The AI's price of this very listing already includes what its text says.
    expected = inputs.aiMarket;
    spread = 0.15;
    basis = 'annonce';
    factors.push('Pas encore de courbe pour ce modèle : prix estimé par l’IA pour cette annonce');
  } else {
    return null;
  }

  const { low, high } = range(expected, spread);
  factors.push(`Prix attendu ≈ ${euros(expected)} (fourchette ${euros(low)} – ${euros(high)})`);
  return {
    discount: Math.round(((expected - ad.price) / expected) * 100),
    expected: Math.round(expected),
    low: Math.round(low),
    high: Math.round(high),
    basis,
    peers,
    factors,
  };
}

export function estimateAll(ads: StoredAd[], plan: Plan | null | undefined, curves: Record<string, PriceCurve>, now = Date.now()): Map<string, Estimate> {
  const out = new Map<string, Estimate>();
  for (const ad of ads) {
    const e = estimateOf(ad, priceInputs(ad, plan, curves), now);
    if (e) out.set(ad.id, e);
  }
  return out;
}
