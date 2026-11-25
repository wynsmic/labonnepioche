import type { Ad, Search } from '../../contracts/types';

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
/** `pros`: also professional sellers (by default, private sellers only: the deals come from them). */
export function buildSearchUrl(search: Search, locations: string | null, page = 1, opts: { pros?: boolean } = {}): string {
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
  if (!opts.pros) params.set('owner_type', 'private');
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

export const firstNumber = (value: string | undefined) => {
  const digits = value?.replace(/[^\d]/g, '') ?? '';
  return digits ? Number(digits) : null;
};

/** Each group of the search has at least one of its words (or a word starting with it) in the listing. */
export function hasRequiredWords(ad: Ad, groups: string[][] | undefined): boolean {
  if (!groups?.length) return true;
  const haystack = ` ${normalize(`${ad.title} ${ad.body} ${Object.values(ad.attributes).join(' ')}`)} `;
  return groups.every((group) => {
    // A one-letter word ("h" for hybrid) would match the start of almost any word: ignored.
    const words = group.map(normalize).filter((w) => w.length > 1);
    return !words.length || words.some((w) => haystack.includes(` ${w}`));
  });
}

/**
 * Safety net on what Leboncoin returned: a private seller (unless `pros`), and a listing that matches the planned
 * search (all its keywords in the title or make/model, the version's required words, price, year
 * and mileage within range). Unknown values pass.
 */
/**
 * Mainland France and Corsica: overseas postcodes (97x, 98x) and positions outside the mainland box
 * are out (shipping or travel costs make them no deal). Unknown place passes.
 */
export function isMetropolitan(ad: Pick<Ad, 'zipcode' | 'lat' | 'lng'>): boolean {
  if (ad.zipcode && /^9[78]/.test(ad.zipcode.trim())) return false;
  if (ad.lat != null && ad.lng != null) return ad.lat >= 41 && ad.lat <= 51.5 && ad.lng >= -5.5 && ad.lng <= 10;
  return true;
}

export function matchesSearch(ad: Ad, search: Search, opts: { pros?: boolean } = {}): boolean {
  if ((ad.seller === 'pro' && !opts.pros) || !isMetropolitan(ad)) return false;
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

/** "https://www.leboncoin.fr/voitures/3313786723.htm?…" or ".../ad/voitures/3313786723" -> the listing page to read. */
export function listingUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (!/(^|\.)leboncoin\.fr$/.test(url.hostname)) return null;
  const id = url.pathname.match(/(\d{8,})/)?.[1];
  if (!id) return null;
  const category = url.pathname.split('/').filter(Boolean).find((p) => p !== 'ad' && !/\d/.test(p)) ?? 'voitures';
  return `https://www.leboncoin.fr/ad/${category}/${id}`;
}
