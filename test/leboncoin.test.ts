import { describe, expect, it } from 'vitest';
import { buildSearchUrl, hasRequiredWords, isExcluded, locationsFromUrl, matchesSearch } from '../server/domain/leboncoin';
import type { Ad } from '../contracts/types';
import type { Search } from '../contracts/types';

const search: Search = {
  label: 'Yaris',
  pick: 'Toyota Yaris III',
  why: 'fiable',
  category: 2,
  text: ' yaris hybride ',
  price_min: 6000,
  price_max: 12000,
  mileage_min: null,
  mileage_max: 120000,
  regdate_min: 2014,
  regdate_max: null,
  required_groups: [],
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
      owner_type: 'private',
      sort: 'time',
      order: 'desc',
      page: '2',
    });
  });

  it('leaves out empty filters and the first page number', () => {
    const url = new URL(
      buildSearchUrl({ ...search, text: '', price_min: null, price_max: null, mileage_max: null, regdate_min: null }, null),
    );
    expect([...url.searchParams.keys()]).toEqual(['category', 'owner_type', 'sort', 'order']);
  });

  it('includes professional sellers on demand', () => {
    expect(new URL(buildSearchUrl(search, null, 1, { pros: true })).searchParams.has('owner_type')).toBe(false);
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
  it('never drops a listing for the seller’s situation', () => {
    expect(isExcluded('Vends cause départ, urgent', ['urgent', 'vendeur pressé', 'départ'])).toBe(false);
    expect(isExcluded('Boîte de vitesse HS', ['boîte de vitesse HS'])).toBe(true);
  });
  it('matches whole words only', () => {
    expect(isExcluded('Moteur HS, vendue en l’état', ['moteur hs'])).toBe(true);
    expect(isExcluded('Yaris, climatisation automatique', ['auto'])).toBe(false);
  });
});

describe('matchesSearch', () => {
  const listing = (title: string, price: number, attrs: Record<string, string>): Ad => ({
    id: '1', url: 'u', title, body: '', price, date: null, city: null, zipcode: null, lat: null, lng: null,
    image: null, seller: null, attributes: attrs,
  });
  const yaris = { ...search, text: 'toyota yaris' };

  it('keeps listings of the searched model within the ranges', () => {
    expect(matchesSearch(listing('Toyota Yaris hybride', 9000, { regdate: '2016', mileage: '98000 km' }), yaris)).toBe(true);
    expect(matchesSearch(listing('Yaris 1.5', 9000, { brand: 'Toyota', regdate: '2016' }), yaris)).toBe(true);
  });
  it('drops other models and listings out of range', () => {
    expect(matchesSearch(listing('Peugeot 208', 9000, {}), yaris)).toBe(false);
    expect(matchesSearch(listing('Toyota Yaris', 15000, {}), yaris)).toBe(false);
    expect(matchesSearch(listing('Toyota Yaris', 9000, { regdate: '2010' }), yaris)).toBe(false);
    expect(matchesSearch(listing('Toyota Yaris', 9000, { mileage: '180 000 km' }), yaris)).toBe(false);
  });
  it('drops professional sellers', () => {
    expect(matchesSearch({ ...listing('Toyota Yaris', 9000, {}), seller: 'pro' }, yaris)).toBe(false);
    expect(matchesSearch({ ...listing('Toyota Yaris', 9000, {}), seller: 'pro' }, yaris, { pros: true })).toBe(true);
  });
});

describe('hasRequiredWords', () => {
  const ad = (title: string, body = '', attributes: Record<string, string> = {}) =>
    ({ id: '1', url: '', title, body, price: 1, date: null, city: null, zipcode: null, lat: null, lng: null, image: null, seller: 'private', attributes }) as const;
  const groups = [['touring', 'ts', 'break', 'sw'], ['hybride', 'hybrid', 'hsd']];
  it('needs one word of every group, in title, body or attributes', () => {
    expect(hasRequiredWords({ ...ad('Corolla Touring Sports 122h', '', { fuel: 'Hybride' }) }, groups)).toBe(true);
    expect(hasRequiredWords({ ...ad('Corolla hybride berline') }, groups)).toBe(false);
  });
  it('passes when the search has no required words', () => {
    expect(hasRequiredWords({ ...ad('Corolla') }, [])).toBe(true);
    expect(hasRequiredWords({ ...ad('Corolla') }, undefined)).toBe(true);
  });
});
