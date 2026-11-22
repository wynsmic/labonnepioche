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
    const e = estimateAll([ad('x', 9000, '2020', '80 000 km')], new Map([['x', 10000]]), 2026).get('x')!;
    expect(e).toMatchObject({ basis: 'ia', discount: 10 });
  });
});
