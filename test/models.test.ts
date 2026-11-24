import { describe, expect, it } from 'vitest';
import { keyFacts, pickOf, trimOf } from '../src/shared/models';
import { hasRequiredWords } from '../src/shared/leboncoin';
import type { Ad, Plan } from '../src/shared/types';

const ad = (over: Partial<Ad & { searchLabel: string | null }> = {}): Ad & { searchLabel: string | null } => ({
  id: '1',
  url: 'https://www.leboncoin.fr/ad/voitures/1',
  title: 'Lexus nx300h',
  body: '',
  price: 25000,
  date: null,
  city: null,
  zipcode: null,
  lat: null,
  lng: null,
  image: null,
  seller: 'private',
  attributes: {
    brand: 'Lexus',
    model: 'NX',
    issuance_date: '05/2021',
    regdate: '2021',
    mileage: '105000 km',
    fuel: 'Hybride',
    horse_power_din: '197 Ch',
    gearbox: 'Automatique',
    u_car_finition: 'Pack Business',
  },
  searchLabel: null,
  ...over,
});

const pick = (name: string, trims: { name: string; note: string }[] = []) => ({
  name,
  tier: 'excellent' as const,
  versions: [],
  years: '',
  why: '',
  fair_price: '',
  tagline: '',
  tags: [],
  trims,
  price_points: [],
});

const plan = {
  shortlist: [pick('Lexus NX 300h', [{ name: 'Pack', note: 'entrée' }, { name: 'Business', note: 'flotte' }]), pick('Toyota RAV4 V')],
  research: '',
  criteria: [],
  searches: [{ label: 'RAV4', pick: 'Toyota RAV4 V' }],
} as unknown as Plan;

describe('pickOf', () => {
  it('uses the choice the search targets', () => {
    expect(pickOf(plan, ad({ searchLabel: 'RAV4' }))?.name).toBe('Toyota RAV4 V');
  });
  it('falls back to the words shared with the listing', () => {
    expect(pickOf(plan, ad())?.name).toBe('Lexus NX 300h');
  });
  it('goes by the stated model, not the make and fuel words', () => {
    const two = { ...plan, shortlist: [pick('Toyota Corolla Touring Sports Hybride'), pick('Toyota RAV4 V 2.5 Hybrid 2WD')] } as Plan;
    const rav4 = ad({ title: 'Toyota Rav4 hybride 222ch Collection', attributes: { brand: 'Toyota', model: 'RAV4' } });
    expect(pickOf(two, rav4)?.name).toBe('Toyota RAV4 V 2.5 Hybrid 2WD');
  });
  it('gives up on a listing of another model', () => {
    expect(pickOf(plan, ad({ title: 'Peugeot 308', attributes: { brand: 'Peugeot', model: '308' } }))).toBeNull();
  });
});

describe('trimOf', () => {
  it('explains a stated trim with the longest known name inside it', () => {
    expect(trimOf(ad(), plan.shortlist[0])).toEqual({ name: 'Pack Business', note: 'flotte' });
  });
  it('finds a known trim in the title', () => {
    expect(trimOf(ad({ title: 'Lexus NX business 2020', attributes: {} }), plan.shortlist[0])?.name).toBe('Business');
  });
});

it('keyFacts labels year, mileage, engine and gearbox', () => {
  expect(keyFacts(ad())).toEqual([
    { label: 'Année', value: '05/2021' },
    { label: 'Kilométrage', value: '105\u202f000 km' },
    { label: 'Moteur', value: 'Hybride 197 ch' },
    { label: 'Boîte', value: 'Boîte auto' },
  ]);
});

it('keyFacts flags a year outside the chosen range', () => {
  const card = { ...pick('Lexus NX 300h'), years: '2015–2020' };
  expect(keyFacts(ad(), card)[0]).toEqual({ label: 'Année', value: '05/2021', hint: 'hors 2015–2020', tone: 'warn' });
});

it('required words ignore one-letter synonyms', () => {
  expect(hasRequiredWords(ad({ title: 'Honda Jazz' }), [['diesel', 'h']])).toBe(false);
});
