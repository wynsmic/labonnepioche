import { describe, expect, it } from 'vitest';
import { ageInDays, comparables, compare, comparableQuery, engineOf, numberFrom } from '../src/shared/compare';
import type { Ad } from '../src/shared/types';

const ad = (id: string, price: number | null, attrs: Record<string, string> = {}, title = 'Toyota Yaris'): Ad => ({
  id,
  url: `https://www.leboncoin.fr/ad/voitures/${id}`,
  title,
  body: '',
  price,
  date: null,
  city: 'Lyon',
  zipcode: '69000',
  lat: null,
  lng: null,
  image: null,
  seller: 'private',
  attributes: { brand: 'Toyota', model: 'Yaris', regdate: '2016', mileage: '100 000 km', fuel: 'Hybride', ...attrs },
});

describe('comparableQuery', () => {
  it('searches the model nationally over ±4 years, any mileage and price (spread for the curve)', () => {
    const q = comparableQuery(ad('1', 9000), 2);
    expect(q).toMatchObject({ category: 2, text: 'Toyota Yaris', regdate_min: 2012, regdate_max: 2020, mileage_min: null, mileage_max: null, price_min: null });
  });
});

describe('compare', () => {
  const at = '2026-11-23T12:00:00Z';
  const target = ad('1', 8000, { regdate: '2018', mileage: '90 000 km' });
  const query = comparableQuery(target, 2);
  // A clean market: 2014–2022, price falling with age and mileage.
  const market = Array.from({ length: 40 }, (_, i) => {
    const year = 2014 + (i % 9);
    const age = 2026 - year + 0.4;
    const km = Math.round(13_000 * age * (0.7 + (i % 5) * 0.15));
    const price = Math.round(22_000 * Math.pow(1 + age, -0.4) * Math.pow((1 + km / 10_000) / (1 + (13_000 * age) / 10_000), -0.25) * (1 + ((i * 7) % 11 - 5) / 100));
    return ad(String(100 + i), price, { regdate: String(year), mileage: `${km} km` });
  });

  it('fits the model curve and places the listing on it', () => {
    const r = compare(target, [target, ...market], query, [], at)!;
    expect(r.curve.source).toBe('marche');
    expect(r.curve.slopes).toBe('donnees');
    expect(r.comparison.count).toBeGreaterThanOrEqual(38);
    // Expected price of a typical 2018 at 90 000 km on the market's own curve.
    const truth = 22_000 * Math.pow(1 + 8.9, -0.4) * Math.pow((1 + 9) / (1 + (13_000 * 8.9) / 10_000), -0.25);
    expect(r.comparison.median / truth).toBeGreaterThan(0.93);
    expect(r.comparison.median / truth).toBeLessThan(1.07);
    expect(r.comparison.p25).toBeLessThan(r.comparison.median);
    expect(r.comparison.p75).toBeGreaterThan(r.comparison.median);
    expect(r.comparison.cheapest[0].adjusted).toBeLessThanOrEqual(r.comparison.cheapest[1].adjusted!);
  });

  it('drops other versions, unpriced, duplicates, professionals and disqualified listings', () => {
    const noisy = [
      ...market,
      ad('20', 3000, { fuel: 'Diesel', regdate: '2018' }),
      ad('21', null),
      ad('100', 9000),
      ad('22', 2000, { regdate: '2018' }, 'Yaris pour pièces'),
      { ...ad('23', 12000, { regdate: '2018' }), seller: 'pro' as const },
    ];
    expect(compare(target, noisy, query, ['pour pièces'], at)!.comparison.count).toBe(compare(target, market, query, [], at)!.comparison.count);
  });

  it('says nothing with too few comparables', () => {
    expect(compare(target, market.slice(0, 5), query, [], at)).toBeNull();
  });
});

it('reads numbers from Leboncoin labels', () => {
  expect(numberFrom('98 000 km')).toBe(98000);
  expect(numberFrom(undefined)).toBeNull();
});

it('measures the age of a listing in days', () => {
  const now = Date.parse('2026-11-20T12:00:00');
  expect(ageInDays('2026-11-17 12:00:00', now)).toBe(3);
  expect(ageInDays('2026-11-20 06:00:00', now)).toBe(0.25);
  expect(ageInDays(null, now)).toBeNull();
});

describe('engineOf', () => {
  it('reads displacement, family and power from the title', () => {
    expect(engineOf(ad('1', 1, {}, 'Renault Clio IV 1.5 dCi 90ch Business'))).toEqual({ displacement: '1.5', family: 'dci', power: 90 });
  });
  it('joins split family names and ignores prices', () => {
    expect(engineOf(ad('1', 1, {}, 'Peugeot 308 Blue HDi 130 cv 1.500 € de frais'))).toMatchObject({ family: 'bluehdi', power: 130, displacement: null });
  });
});

describe('comparables', () => {
  const target = ad('1', 8000, {}, 'Clio 1.5 dCi 90');
  it('keeps the same engine when enough listings state it', () => {
    const same = Array.from({ length: 15 }, (_, i) => ad(`s${i}`, 9000, {}, 'Clio 1.5 dCi 90ch'));
    const other = [1, 2].map((i) => ad(`o${i}`, 9000, {}, 'Clio 0.9 TCe 90'));
    const r = comparables(target, [...same, ...other], []);
    expect(r.match).toBe('motorisation');
    expect(r.kept.map((a) => a.id)).toEqual(same.map((a) => a.id));
  });
  it('falls back to the same model when too few state the engine', () => {
    const r = comparables(target, [1, 2, 3, 4, 5].map((i) => ad(`m${i}`, 9000, {}, 'Clio')), []);
    expect(r.match).toBe('modele');
    expect(r.kept).toHaveLength(5);
  });
});
