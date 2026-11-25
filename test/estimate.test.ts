import { describe, expect, it } from 'vitest';
import { curveKey, estimateOf } from '../server/domain/estimate';
import type { Facts } from '../server/domain/facts';
import { predict, type PriceCurve } from '../server/domain/pricing';
import type { Ad } from '../contracts/types';

const now = Date.UTC(2026, 10, 23);
const ad = (price: number, regdate: string, mileage: string): Ad => ({
  id: 'x', url: '', title: 'Dacia Duster', body: '', price, date: null, city: null, zipcode: null, lat: null, lng: null,
  image: null, seller: 'private', attributes: { brand: 'Dacia', model: 'Duster', fuel: 'Diesel', regdate, mileage },
});
const curve: PriceCurve = { c: Math.log(24_000), alpha: 0.36, beta: 0.25, spread: 0.1, source: 'marche', n: 60, slopes: 'donnees', years: [2016, 2024] };
const facts = (over: Partial<Facts>): Facts => ({
  id: 'x', accident: 'aucun', owners: 1, mileage_doubt: false, condition: 'bon', repairs: [], cosmetic: [], maintenance: 'complet',
  ct: 'ok', equipment: 'courant', adjust_pct: 0, adjust_reason: '', ...over,
});

describe('estimateOf', () => {
  it('reads the expected price on the model curve, with a range', () => {
    const typical = predict(curve, 6.4, 80_000);
    const e = estimateOf(ad(Math.round(typical), '2020', '80 000 km'), { curve, facts: null, aiMarket: null }, now)!;
    expect(e.basis).toBe('marche');
    expect(e.peers).toBe(60);
    expect(Math.abs(e.discount)).toBeLessThanOrEqual(1);
    expect(e.low).toBeLessThan(e.expected);
    expect(e.high).toBeGreaterThan(e.expected);
  });

  it('applies the accident rule and the AI reading of the text', () => {
    const base = estimateOf(ad(10_000, '2020', '80 000 km'), { curve, facts: null, aiMarket: null }, now)!;
    const hit = estimateOf(ad(10_000, '2020', '80 000 km'), { curve, facts: facts({ accident: 'lourd', adjust_pct: -10, adjust_reason: 'embrayage à prévoir' }), aiMarket: null }, now)!;
    expect(hit.expected / base.expected).toBeCloseTo(0.7 * 0.9, 2);
    expect(hit.factors.join(' ')).toContain('embrayage à prévoir');
  });

  it('caps the AI adjustment', () => {
    const base = estimateOf(ad(10_000, '2020', '80 000 km'), { curve, facts: null, aiMarket: null }, now)!;
    const wild = estimateOf(ad(10_000, '2020', '80 000 km'), { curve, facts: facts({ adjust_pct: 60 }), aiMarket: null }, now)!;
    expect(wild.expected / base.expected).toBeCloseTo(1.12, 2);
  });

  it('falls back to the AI price of the listing without a curve', () => {
    expect(estimateOf(ad(9_000, '2020', '80 000 km'), { curve: null, facts: null, aiMarket: 10_000 }, now)).toMatchObject({ basis: 'annonce', discount: 10 });
  });
});

it('keys one curve per make, model and fuel', () => {
  expect(curveKey(ad(1, '2020', '1 km'))).toBe('dacia|duster|diesel');
});
