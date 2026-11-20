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

/** True when the listing contains one of the plan's disqualifying expressions (whole words). */
export function isExcluded(text: string, excludeKeywords: string[]): boolean {
  const haystack = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  return excludeKeywords.some((k) => {
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

/**
 * Safety net on what Leboncoin returned: the listing must match the planned search (all its
 * keywords in the title or make/model, price, year and mileage within range). Unknown values pass.
 */
export function matchesSearch(ad: Ad, search: Search): boolean {
  const haystack = ` ${normalize(`${ad.title} ${ad.attributes.brand ?? ''} ${ad.attributes.model ?? ''}`)} `;
  const words = normalize(search.text).split(' ').filter((w) => w.length > 1);
  if (!words.every((w) => haystack.includes(` ${w} `) || haystack.includes(` ${w}`))) return false;
  const within = (v: number | null, min: number | null, max: number | null) =>
    v == null || ((min == null || v >= min) && (max == null || v <= max));
  const year = firstNumber(ad.attributes.regdate);
  return (
    within(ad.price, search.price_min, search.price_max) &&
    within(year ? Number(String(year).slice(0, 4)) : null, search.regdate_min, search.regdate_max) &&
    within(firstNumber(ad.attributes.mileage), search.mileage_min, search.mileage_max)
  );
}
