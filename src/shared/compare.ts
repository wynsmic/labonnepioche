import { isExcluded } from './leboncoin';
import type { Ad, Search } from './types';
import { adjustPrice, fitCurve, type Curve } from './depreciation';

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
  curve?: Curve;
  /** Sorted prices (adjusted), for the strip chart. */
  prices: number[];
  /** The cheapest comparable listings, for a look. */
  cheapest: { title: string; price: number; adjusted?: number; mileage: number | null; year: number | null; city: string | null; url: string }[];
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

/** Engine families named in listings (normalized: lower case, no accents, no spaces or dashes). */
const ENGINE_FAMILIES = [
  'bluehdi', 'ehdi', 'hdi', 'dci', 'tce', 'sce', 'puretech', 'thp', 'vti', 'tdi', 'tsi', 'tfsi', 'fsi', 'crdi',
  'cdti', 'tdci', 'ecoboost', 'idtec', 'dtec', 'ivtec', 'vtec', 'd4d', 'multijet', 'jtd', 'gdi', 'tgdi',
  'skyactivg', 'skyactivd', 'cdi', 'bluetec', 'etech', 'hybride', 'hybrid', 'phev',
];

export interface Engine {
  displacement: string | null;
  power: number | null;
  family: string | null;
}

const fold = (text: string) => text.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

/** Engine as stated by the listing: title first, then version, then the start of the description. */
export function engineOf(ad: Ad): Engine {
  const sources = [ad.title, ad.attributes.vehicle_version ?? '', ad.body.slice(0, 600)].map(fold);
  let displacement: string | null = null;
  let power: number | null = numberFrom(ad.attributes.horse_power_din ?? ad.attributes.horsepower);
  let family: string | null = null;
  for (const text of sources) {
    displacement ??= text.match(/(?:^|[^\d.,])([0-6])[.,](\d)(?![\d.,])/)?.slice(1, 3).join('.') ?? null;
    power ??= (() => {
      const n = Number(text.match(/\b(\d{2,3})\s?(?:ch|cv|hp)\b/)?.[1]);
      return n >= 40 && n <= 700 ? n : null;
    })();
    if (!family) {
      const squashed = ` ${text.replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
      const joined = squashed.replace(/ (blue|e|i|t|skyactiv) (hdi|tech|dtec|vtec|gdi|g|d)\b/g, ' $1$2');
      family = ENGINE_FAMILIES.find((f) => joined.includes(` ${f} `)) ?? null;
    }
  }
  return { displacement, power, family };
}

export function describeEngine(e: Engine): string | null {
  const parts = [e.displacement, e.family, e.power ? `${e.power} ch` : null].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

/** Same engine: no stated dimension contradicts and at least one is confirmed. */
function sameEngine(a: Engine, b: Engine): boolean {
  let confirmed = 0;
  if (a.displacement && b.displacement) {
    if (a.displacement !== b.displacement) return false;
    confirmed++;
  }
  if (a.family && b.family) {
    if (a.family !== b.family) return false;
    confirmed++;
  }
  if (a.power && b.power) {
    if (Math.abs(a.power - b.power) / a.power > 0.08) return false;
    confirmed++;
  }
  return confirmed > 0;
}

/**
 * Truly comparable listings (priced, private, same version, not disqualified, not this one):
 * the same engine when enough listings state it, else the same model, fuel and gearbox.
 */
export function comparables(
  ad: Ad,
  candidates: Ad[],
  excludeKeywords: string[],
): { kept: Ad[]; match: Comparison['match']; engine: Engine } {
  const seen = new Set<string>([ad.id]);
  const pool = candidates.filter((c) => {
    // Same market as the listings we hunt: private sellers only.
    if (seen.has(c.id) || c.price == null || c.price < 100 || c.seller === 'pro') return false;
    seen.add(c.id);
    return sameVersion(ad, c) && !isExcluded(`${c.title} ${c.body}`, excludeKeywords);
  });
  const engine = engineOf(ad);
  const sameMotor = pool.filter((c) => sameEngine(engine, engineOf(c)));
  return sameMotor.length >= MIN_COMPARABLES
    ? { kept: sameMotor, match: 'motorisation', engine }
    : { kept: pool, match: 'modele', engine };
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
  const { kept, match, engine } = comparables(ad, candidates, excludeKeywords);
  if (kept.length < MIN_COMPARABLES) return null;
  // Each comparable's price as if it had this listing's year and mileage.
  const to = { year: Number(yearOf(ad)) || null, km: mileageOf(ad) };
  const curve = fitCurve(kept.map((c) => ({ price: c.price!, year: Number(yearOf(c)) || null, km: mileageOf(c) })));
  const adjusted = new Map(
    kept.map((c) => [c.id, Math.round(adjustPrice(c.price!, { year: Number(yearOf(c)) || null, km: mileageOf(c) }, to, curve))]),
  );
  const prices = [...adjusted.values()].sort((x, y) => x - y);
  const pricier = prices.filter((p) => p > ad.price!).length;
  const cheapest = [...kept].sort((x, y) => adjusted.get(x.id)! - adjusted.get(y.id)!).slice(0, 5);
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
    match,
    engine: describeEngine(engine),
    adjustedTo: to,
    curve,
    medianMileage: median(kept.map(mileageOf).filter((m): m is number => m != null)),
    medianYear: median(kept.map((c) => Number(yearOf(c))).filter((y) => y > 0)),
    prices,
    cheapest: cheapest.map((c) => ({
      title: c.title,
      price: c.price!,
      adjusted: adjusted.get(c.id)!,
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
