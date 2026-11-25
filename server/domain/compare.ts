import { isExcluded, isMetropolitan } from './leboncoin';
import type { Ad, Comparison, Search } from '../../contracts/types';

export type { Comparison };
import { ageFrom, fitMarket, implausibleKm, kmFrom, predict, project, range, type PriceCurve } from './pricing';


export const MIN_COMPARABLES = 5;
/** The same-engine subset is used for the curve only when it is this large. */
export const MIN_SAME_ENGINE = 15;

/** "98 000 km" -> 98000; "2016" -> 2016. */
export function numberFrom(value: string | undefined): number | null {
  if (!value) return null;
  const digits = value.replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

const mileageOf = (ad: Ad) => numberFrom(ad.attributes.mileage);
const yearOf = (ad: Ad) => numberFrom(ad.attributes.regdate)?.toString().slice(0, 4) ?? null;

/**
 * National search for the price curve of this model: same make and model, ±4 years, any mileage
 * and price (a wide spread of ages and mileages is what makes the curve reliable; price caps would
 * cut the market). Falls back to the listing's title words when it has no make/model.
 */
export function comparableQuery(ad: Ad, category: number): Search {
  const make = ad.attributes.brand ?? ad.attributes.u_car_brand;
  const model = ad.attributes.model ?? ad.attributes.u_car_model;
  const text = make && model ? `${make} ${model}` : ad.title.split(/\s+/).slice(0, 3).join(' ');
  const year = Number(yearOf(ad)) || null;
  return {
    label: `Comparables de « ${ad.title} »`,
    pick: '',
    why: 'Repères de prix en France',
    category,
    text,
    price_min: null,
    price_max: null,
    mileage_min: null,
    mileage_max: null,
    regdate_min: year ? year - 4 : null,
    regdate_max: year ? year + 4 : null,
    required_groups: [],
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
    // Overseas prices are another market.
    if (seen.has(c.id) || c.price == null || c.price < 100 || c.seller === 'pro' || !isMetropolitan(c)) return false;
    seen.add(c.id);
    return sameVersion(ad, c) && !isExcluded(`${c.title} ${c.body}`, excludeKeywords);
  });
  const engine = engineOf(ad);
  const sameMotor = pool.filter((c) => sameEngine(engine, engineOf(c)));
  return sameMotor.length >= MIN_SAME_ENGINE
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
 * Fits the price curve of the model on the truly comparable listings (priced, same version, not
 * disqualified, not this one), then brings each of them to this listing's age and mileage along
 * that curve. The expected price is the curve at this listing; its range comes from the spread of
 * the listings around the curve. Null when too few listings remain to fit anything.
 */
export function compare(
  ad: Ad,
  candidates: Ad[],
  query: Search,
  excludeKeywords: string[],
  at: string,
  prior: PriceCurve | null = null,
  now = Date.parse(at),
): { comparison: Comparison; curve: PriceCurve } | null {
  if (ad.price == null) return null;
  const age = ageFrom(ad.attributes, now);
  if (age == null) return null;
  const km = kmFrom(ad.attributes);
  const { kept, match, engine } = comparables(ad, candidates, excludeKeywords);
  const points = kept
    .map((c) => ({ ad: c, age: ageFrom(c.attributes, now), km: kmFrom(c.attributes) }))
    .filter((p): p is { ad: Ad; age: number; km: number | null } => p.age != null);
  const fit = fitMarket(points.map((p) => ({ age: p.age, km: p.km, price: p.ad.price! })), prior, new Date(now));
  if (!fit) return null;
  const to = { age, km };
  const projected = points
    .filter((p) => !implausibleKm(p.km, p.age))
    .map((p) => ({ p, value: Math.round(project(fit.curve, p.ad.price!, { age: p.age, km: p.km }, to)) }));
  // The strip shows the listings closest in age (the ones the projection moves least).
  const near = projected.filter((x) => Math.abs(x.p.age - age) <= 2.5);
  const shown = near.length >= MIN_COMPARABLES ? near : projected;
  const prices = shown.map((x) => x.value).sort((a, b) => a - b);
  const expected = predict(fit.curve, age, km);
  const { low, high } = range(expected, fit.curve.spread);
  const cheapest = [...shown].sort((a, b) => a.value - b.value).slice(0, 5);
  return {
    curve: fit.curve,
    comparison: {
      at,
      query,
      count: fit.curve.n,
      median: Math.round(expected),
      p25: Math.round(low),
      p75: Math.round(high),
      min: prices[0],
      max: prices[prices.length - 1],
      cheaperThan: Math.round((prices.filter((v) => v > ad.price!).length / prices.length) * 100),
      match,
      engine: describeEngine(engine),
      adjustedTo: { year: Number(yearOf(ad)) || null, km },
      curve: fit.curve,
      medianMileage: median(shown.map((x) => x.p.km).filter((m): m is number => m != null)),
      medianYear: median(shown.map((x) => Number(yearOf(x.p.ad))).filter((y) => y > 0)),
      prices,
      cheapest: cheapest.map(({ p, value }) => ({
        title: p.ad.title,
        price: p.ad.price!,
        adjusted: value,
        mileage: p.km,
        year: Number(yearOf(p.ad)) || null,
        city: p.ad.city,
        url: p.ad.url,
      })),
    },
  };
}

/** Days since the listing was first published (Leboncoin dates are local "YYYY-MM-DD HH:MM:SS"). */
export function ageInDays(date: string | null, now = Date.now()): number | null {
  if (!date) return null;
  const t = Date.parse(date.replace(' ', 'T'));
  return Number.isNaN(t) ? null : Math.max(0, (now - t) / 86_400_000);
}
