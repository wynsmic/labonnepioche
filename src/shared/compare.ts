import { isExcluded } from './leboncoin';
import type { Ad, Search } from './types';

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
  /** Sorted prices, for the strip chart. */
  prices: number[];
  /** The cheapest comparable listings, for a look. */
  cheapest: { title: string; price: number; mileage: number | null; year: number | null; city: string | null; url: string }[];
}

export const MIN_COMPARABLES = 5;

/** "98 000 km" -> 98000; "2016" -> 2016. */
export function numberFrom(value: string | undefined): number | null {
  if (!value) return null;
  const digits = value.replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

const mileageOf = (ad: Ad) => numberFrom(ad.attributes.mileage);
const yearOf = (ad: Ad) => numberFrom(ad.attributes.regdate)?.toString().slice(0, 4) ?? null;

/**
 * National search for listings very close to this one: same make and model, ±1 year,
 * mileage within ±30 %. Falls back to the listing's title words when it has no make/model.
 */
export function comparableQuery(ad: Ad, category: number): Search {
  const make = ad.attributes.brand ?? ad.attributes.u_car_brand;
  const model = ad.attributes.model ?? ad.attributes.u_car_model;
  const text = make && model ? `${make} ${model}` : ad.title.split(/\s+/).slice(0, 3).join(' ');
  const year = Number(yearOf(ad)) || null;
  const mileage = mileageOf(ad);
  return {
    label: `Comparables de « ${ad.title} »`,
    why: 'Repères de prix en France',
    category,
    text,
    price_min: null,
    price_max: null,
    mileage_min: mileage ? Math.round((mileage * 0.7) / 1000) * 1000 : null,
    mileage_max: mileage ? Math.round((mileage * 1.3) / 1000) * 1000 : null,
    regdate_min: year ? year - 1 : null,
    regdate_max: year ? year + 1 : null,
    exclude_keywords: [],
  };
}

/** Same fuel and gearbox when both listings state them (the closest Leboncoin offers to "same version"). */
function sameVersion(a: Ad, b: Ad): boolean {
  for (const key of ['fuel', 'gearbox']) {
    const x = a.attributes[key];
    const y = b.attributes[key];
    if (x && y && x.toLowerCase() !== y.toLowerCase()) return false;
  }
  return true;
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo));
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  return quantile([...values].sort((x, y) => x - y), 0.5);
}

/**
 * Keeps the truly comparable listings (priced, same version, not disqualified, not this one)
 * and places this listing's price among them. Null when too few remain to say anything.
 */
export function compare(ad: Ad, candidates: Ad[], query: Search, excludeKeywords: string[], at: string): Comparison | null {
  if (ad.price == null) return null;
  const seen = new Set<string>([ad.id]);
  const kept = candidates.filter((c) => {
    // Same market as the listings we hunt: private sellers only.
    if (seen.has(c.id) || c.price == null || c.price < 100 || c.seller === 'pro') return false;
    seen.add(c.id);
    return sameVersion(ad, c) && !isExcluded(`${c.title} ${c.body}`, excludeKeywords);
  });
  if (kept.length < MIN_COMPARABLES) return null;
  const prices = kept.map((c) => c.price!).sort((x, y) => x - y);
  const pricier = prices.filter((p) => p > ad.price!).length;
  const cheapest = [...kept].sort((x, y) => x.price! - y.price!).slice(0, 5);
  return {
    at,
    query,
    count: prices.length,
    median: quantile(prices, 0.5),
    p25: quantile(prices, 0.25),
    p75: quantile(prices, 0.75),
    min: prices[0],
    max: prices[prices.length - 1],
    cheaperThan: Math.round((pricier / prices.length) * 100),
    medianMileage: median(kept.map(mileageOf).filter((m): m is number => m != null)),
    medianYear: median(kept.map((c) => Number(yearOf(c))).filter((y) => y > 0)),
    prices,
    cheapest: cheapest.map((c) => ({
      title: c.title,
      price: c.price!,
      mileage: mileageOf(c),
      year: Number(yearOf(c)) || null,
      city: c.city,
      url: c.url,
    })),
  };
}

/** Days since the listing was first published (Leboncoin dates are local "YYYY-MM-DD HH:MM:SS"). */
export function ageInDays(date: string | null, now = Date.now()): number | null {
  if (!date) return null;
  const t = Date.parse(date.replace(' ', 'T'));
  return Number.isNaN(t) ? null : Math.max(0, (now - t) / 86_400_000);
}
