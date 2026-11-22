import { describe, expect, it } from 'vitest';
import { PRIOR, adjustPrice, fitCurve } from '../src/shared/depreciation';
import { compare, comparableQuery } from '../src/shared/compare';
import type { Ad } from '../src/shared/types';

describe('fitCurve', () => {
  it('keeps the market average with few listings', () => {
    expect(fitCurve([{ price: 10000, year: 2020, km: 50000 }])).toBe(PRIOR);
  });
  it('learns a steeper law from many listings, pulled toward the average', () => {
    // True law: −15 %/year, −4 % per 10 000 km.
    const pts = [];
    for (let y = 2016; y <= 2021; y++)
      for (const km of [40000, 80000, 120000, 160000])
        pts.push({ price: 30000 * 0.85 ** (2024 - y) * Math.exp((-0.04 * km) / 10000), year: y, km });
    const c = fitCurve(pts);
    expect(c.fittedOn).toBe(24);
    expect(Math.exp(c.perYear)).toBeLessThan(0.88);
    expect(Math.exp(c.perYear)).toBeGreaterThan(0.85);
    expect(c.per10kKm).toBeLessThan(-0.03);
  });
});

describe('adjustPrice', () => {
  it('raises an older, more driven car brought to a newer, less driven one', () => {
    const p = adjustPrice(10000, { year: 2019, km: 120000 }, { year: 2020, km: 100000 }, PRIOR);
    expect(Math.round(p)).toBe(Math.round(10000 / 0.9 * Math.exp(0.05)));
  });
});

describe('compare with depreciation', () => {
  const ad = (id: string, price: number, regdate: string, mileage: string): Ad => ({
    id, url: id, title: 'BMW 330e', body: '', price, date: null, city: null, zipcode: null, lat: null, lng: null,
    image: null, seller: 'private', attributes: { brand: 'BMW', model: 'Serie 3', regdate, mileage },
  });
  it('places the price against comparables brought to its year and mileage', () => {
    const target = ad('t', 22000, '2019', '107 000 km');
    // Newer, less driven cars at 28 000: once adjusted to 2019 / 107 000 km they are worth less.
    const others = [1, 2, 3, 4, 5, 6].map((i) => ad(`o${i}`, 28000, '2020', '93 000 km'));
    const c = compare(target, others, comparableQuery(target, 2), [], 'now')!;
    expect(c.median).toBeLessThan(28000 * 0.9 * Math.exp(-0.025 * 1.4) + 1);
    expect(c.adjustedTo).toEqual({ year: 2019, km: 107000 });
  });
});
