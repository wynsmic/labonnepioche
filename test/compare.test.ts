import { describe, expect, it } from 'vitest';
import { ageInDays, compare, comparableQuery, numberFrom } from '../src/shared/compare';
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
  it('searches the same make and model nationally, ±1 year, ±30 % mileage', () => {
    const q = comparableQuery(ad('1', 9000), 2);
    expect(q).toMatchObject({
      category: 2,
      text: 'Toyota Yaris',
      regdate_min: 2015,
      regdate_max: 2017,
      mileage_min: 70000,
      mileage_max: 130000,
    });
  });
});

describe('compare', () => {
  const target = ad('1', 8000);
  const query = comparableQuery(target, 2);
  const others = [9000, 9500, 10000, 10500, 11000, 7500].map((p, i) => ad(String(10 + i), p));

  it('places the price among similar listings', () => {
    const c = compare(target, [target, ...others], query, [], 'now')!;
    expect(c.count).toBe(6);
    expect(c.median).toBe(9750);
    expect(c.cheaperThan).toBe(83); // 5 of 6 cost more
    expect(c.min).toBe(7500);
    expect(c.medianMileage).toBe(100000);
    expect(c.medianYear).toBe(2016);
    expect(c.cheapest[0].price).toBe(7500);
  });

  it('drops other versions, unpriced, duplicates and disqualified listings', () => {
    const noisy = [
      ...others,
      ad('20', 3000, { fuel: 'Diesel' }),
      ad('21', null),
      ad('10', 9000),
      ad('22', 2000, {}, 'Yaris pour pièces'),
    ];
    expect(compare(target, noisy, query, ['pour pièces'], 'now')!.count).toBe(6);
  });

  it('says nothing with too few comparables', () => {
    expect(compare(target, others.slice(0, 3), query, [], 'now')).toBeNull();
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
