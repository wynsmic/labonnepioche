import { describe, expect, it } from 'vitest';
import { buildSearchUrl, isExcluded, locationsFromUrl } from '../src/shared/leboncoin';
import type { Search } from '../src/shared/types';

const search: Search = {
  label: 'Yaris',
  why: 'fiable',
  category: 2,
  text: ' yaris hybride ',
  price_min: 6000,
  price_max: 12000,
  mileage_min: null,
  mileage_max: 120000,
  regdate_min: 2014,
  regdate_max: null,
  exclude_keywords: [],
};

describe('buildSearchUrl', () => {
  it('maps the plan to Leboncoin parameters, open ranges included', () => {
    const url = new URL(buildSearchUrl(search, 'Rennes_35000__48.11_-1.68_10000', 2));
    expect(url.origin + url.pathname).toBe('https://www.leboncoin.fr/recherche');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      category: '2',
      text: 'yaris hybride',
      price: '6000-12000',
      mileage: 'min-120000',
      regdate: '2014-max',
      locations: 'Rennes_35000__48.11_-1.68_10000',
      sort: 'time',
      order: 'desc',
      page: '2',
    });
  });

  it('leaves out empty filters and the first page number', () => {
    const url = new URL(
      buildSearchUrl({ ...search, text: '', price_min: null, price_max: null, mileage_max: null, regdate_min: null }, null),
    );
    expect([...url.searchParams.keys()]).toEqual(['category', 'sort', 'order']);
  });
});

describe('locationsFromUrl', () => {
  it('reuses the area of a Leboncoin search', () => {
    expect(locationsFromUrl('https://www.leboncoin.fr/recherche?category=2&locations=Rennes_35000__48.1_-1.6_10000')).toBe(
      'Rennes_35000__48.1_-1.6_10000',
    );
  });
  it('ignores other sites and malformed input', () => {
    expect(locationsFromUrl('https://example.com/?locations=x')).toBeNull();
    expect(locationsFromUrl('pas une url')).toBeNull();
  });
});

describe('isExcluded', () => {
  it('matches disqualifying keywords case-insensitively', () => {
    expect(isExcluded('Vends Clio POUR PIÈCES', ['pour pièces'])).toBe(true);
    expect(isExcluded('Clio très bon état', ['pour pièces', ' '])).toBe(false);
  });
  it('matches whole words only', () => {
    expect(isExcluded('Moteur HS, vendue en l’état', ['moteur hs'])).toBe(true);
    expect(isExcluded('Yaris, climatisation automatique', ['auto'])).toBe(false);
  });
});
