import { describe, expect, it } from 'vitest';
import { estimateAll } from '../src/shared/estimate';
import type { Ad } from '../src/shared/types';

const ad = (id: string, price: number, regdate: string, mileage: string, body = ''): Ad => ({
  id, url: '', title: 'Dacia Duster', body, price, date: null, city: null, zipcode: null, lat: null, lng: null,
  image: null, seller: 'private', attributes: { brand: 'Dacia', model: 'Duster', fuel: 'Diesel', regdate, mileage },
});

describe('estimateAll', () => {
  const peers = [1, 2, 3, 4, 5].map((i) => ad(`p${i}`, 12000, '2020', '80 000 km'));

  it('is 0 % for a listing priced like its identical peers', () => {
    const e = estimateAll([...peers, ad('x', 12000, '2020', '80 000 km')], new Map(), 2026).get('x')!;
    expect(e.basis).toBe('annonces');
    expect(e.discount).toBe(0);
  });

  it('expects more for a newer, less driven, better kept car', () => {
    const e = estimateAll([...peers, ad('x', 12000, '2022', '40 000 km', 'première main, carnet d entretien')], new Map(), 2026).get('x')!;
    expect(e.expected).toBeGreaterThan(15000);
    expect(e.discount).toBeGreaterThan(20);
    expect(e.factors.join(' ')).toContain('première main');
  });

  it('falls back to the AI market price with too few peers', () => {
    const e = estimateAll([ad('x', 9000, '2020', '80 000 km')], new Map([['x', { france: null, market: 10000, newPrice: null }]]), 2026).get('x')!;
    expect(e).toMatchObject({ basis: 'ia', discount: 10 });
  });

  it('prefers the AI market price to the new price', () => {
    const e = estimateAll([ad('x', 9000, '2020', '80 000 km')], new Map([['x', { france: null, market: 10000, newPrice: 25000 }]]), 2026).get('x')!;
    expect(e.basis).toBe('ia');
  });

  it('uses the national comparison over everything else', () => {
    const all = [...peers, ad('x', 12000, '2020', '80 000 km')];
    const e = estimateAll(all, new Map([['x', { france: { median: 15000, count: 8 }, market: 10000, newPrice: 25000 }]]), 2026).get('x')!;
    expect(e).toMatchObject({ basis: 'france', discount: 20 });
  });

  it('from the new price, corrects only the mileage gap to normal', () => {
    // 6.5 years at 13 000 km/year = 84 500 km: 80 000 km is about normal.
    const e = estimateAll([ad('x', 9000, '2020', '80 000 km')], new Map([['x', { france: null, market: null, newPrice: 25000 }]]), 2026).get('x')!;
    expect(e.basis).toBe('neuf');
    // 25 000 × 0.9 × 0.9^6.5 × e^(+0.011) ≈ 11 470
    expect(e.expected).toBeGreaterThan(11300);
    expect(e.expected).toBeLessThan(11600);
  });
});
