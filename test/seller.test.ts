import { describe, expect, it } from 'vitest';
import { assessSeller, parseMemberSince } from '../server/domain/seller';

const NOW = Date.UTC(2026, 10, 22);
const car = (title: string) => ({ title, price: 15000, category: 'Voitures', date: null });

describe('parseMemberSince', () => {
  it('reads French month and year', () => {
    expect(parseMemberSince('octobre 2015')?.toISOString().slice(0, 7)).toBe('2015-10');
    expect(parseMemberSince('févr. 2024')?.toISOString().slice(0, 7)).toBe('2024-02');
    expect(parseMemberSince(null)).toBeNull();
  });
});

describe('assessSeller', () => {
  it('is fine for an old account with a few personal items', () => {
    const c = assessSeller({ memberSince: 'mars 2014', totalAds: 3, badges: ['téléphone vérifié'], ads: [car('Toyota RAV4'), { title: 'Poussette', price: 80, category: 'Équipement bébé', date: null }] }, 'u', 'Toyota RAV4', NOW);
    expect(c.level).toBe('ok');
  });
  it('flags a brand-new account with a single listing', () => {
    const c = assessSeller({ memberSince: 'novembre 2026', totalAds: 1, badges: [], ads: [car('Toyota RAV4')] }, 'u', 'Toyota RAV4', NOW);
    expect(c.level).toBe('suspect');
    expect(c.flags.join(' ')).toContain('seule annonce');
  });
  it('flags a hidden car dealer', () => {
    const ads = ['Clio', 'Golf', '308', 'Polo', 'Yaris', 'C3', 'RAV4'].map(car);
    const c = assessSeller({ memberSince: 'janvier 2019', totalAds: 7, badges: [], ads }, 'u', 'RAV4', NOW);
    expect(c.otherVehicles).toBe(6);
    expect(c.level).toBe('suspect');
  });
});
