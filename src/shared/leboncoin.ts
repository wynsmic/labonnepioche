import type { Ad, Search } from './types';

const BASE = 'https://www.leboncoin.fr/recherche';

function range(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  return `${min ?? 'min'}-${max ?? 'max'}`;
}

/**
 * Leboncoin search URL for one planned search. `locations` is the raw `locations`
 * parameter copied from a Leboncoin search the user set up with their area
 * (Leboncoin's location format is opaque, so it is reused as is).
 */
export function buildSearchUrl(search: Search, locations: string | null, page = 1): string {
  const params = new URLSearchParams();
  params.set('category', String(search.category));
  if (search.text.trim()) params.set('text', search.text.trim());
  const price = range(search.price_min, search.price_max);
  if (price) params.set('price', price);
  const mileage = range(search.mileage_min, search.mileage_max);
  if (mileage) params.set('mileage', mileage);
  const regdate = range(search.regdate_min, search.regdate_max);
  if (regdate) params.set('regdate', regdate);
  if (locations) params.set('locations', locations);
  // Private sellers only: real deals don't come from professionals.
  params.set('owner_type', 'private');
  params.set('sort', 'time');
  params.set('order', 'desc');
  if (page > 1) params.set('page', String(page));
  return `${BASE}?${params.toString()}`;
}

/** The `locations` parameter of a Leboncoin search URL the user pasted, if any. */
export function locationsFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    if (!parsed.hostname.endsWith('leboncoin.fr')) return null;
    return parsed.searchParams.get('locations');
  } catch {
    return null;
  }
}

/** Seller circumstances are opportunities, never reasons to drop a listing. */
const SELLER_SITUATION = new Set(['urgent', 'presse', 'pressee', 'depart', 'demenagement', 'demenage', 'mutation', 'negociable']);
const isSellerSituation = (keyword: string) =>
  keyword
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .split(/[^\p{L}\p{N}]+/u)
    .some((w) => SELLER_SITUATION.has(w));

/** True when the listing contains one of the plan's disqualifying expressions (whole words). */
export function isExcluded(text: string, excludeKeywords: string[]): boolean {
  const haystack = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  return excludeKeywords.some((k) => {
    if (isSellerSituation(k)) return false;
    const needle = k.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    return needle.length > 0 && haystack.includes(` ${needle} `);
  });
}

const normalize = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const firstNumber = (value: string | undefined) => {
  const digits = value?.replace(/[^\d]/g, '') ?? '';
  return digits ? Number(digits) : null;
};

/** Each group of the search has at least one of its words (or a word starting with it) in the listing. */
export function hasRequiredWords(ad: Ad, groups: string[][] | undefined): boolean {
  if (!groups?.length) return true;
  const haystack = ` ${normalize(`${ad.title} ${ad.body} ${Object.values(ad.attributes).join(' ')}`)} `;
  return groups.every((group) => {
    const words = group.map(normalize).filter((w) => w.length > 0);
    return !words.length || words.some((w) => haystack.includes(` ${w}`));
  });
}

/**
 * Safety net on what Leboncoin returned: a private seller, and a listing that matches the planned
 * search (all its keywords in the title or make/model, the version's required words, price, year
 * and mileage within range). Unknown values pass.
 */
export function matchesSearch(ad: Ad, search: Search): boolean {
  if (ad.seller === 'pro') return false;
  const haystack = ` ${normalize(`${ad.title} ${ad.attributes.brand ?? ''} ${ad.attributes.model ?? ''}`)} `;
  const words = normalize(search.text).split(' ').filter((w) => w.length > 1);
  if (!words.every((w) => haystack.includes(` ${w} `) || haystack.includes(` ${w}`))) return false;
  if (!hasRequiredWords(ad, search.required_groups)) return false;
  const within = (v: number | null, min: number | null, max: number | null) =>
    v == null || ((min == null || v >= min) && (max == null || v <= max));
  const year = firstNumber(ad.attributes.regdate);
  return (
    within(ad.price, search.price_min, search.price_max) &&
    within(year ? Number(String(year).slice(0, 4)) : null, search.regdate_min, search.regdate_max) &&
    within(firstNumber(ad.attributes.mileage), search.mileage_min, search.mileage_max)
  );
}
