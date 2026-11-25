import { describe, expect, it } from 'vitest';
import type { Analysis, PriceCurve, StoredAd } from '../contracts/types';
import { curveKey } from '../server/domain/estimate';
import { predict } from '../server/domain/pricing';
import { searchPages, viewAds, zoneSummary } from '../server/domain/view';

const year = new Date().getUTCFullYear() - 5;
const curve: PriceCurve = { c: Math.log(24_000), alpha: 0.36, beta: 0.25, spread: 0.1, source: 'marche', n: 60, slopes: 'donnees', years: [year - 3, year + 3] };

const stored = (over: Partial<StoredAd> & { price: number }): StoredAd => ({
  id: 'a1', url: 'https://www.leboncoin.fr/ad/voitures/1', title: 'Dacia Duster', body: '', date: null, city: 'Rennes', zipcode: '35000',
  lat: null, lng: null, image: null, seller: 'private', attributes: { brand: 'Dacia', model: 'Duster', fuel: 'Diesel', regdate: String(year), mileage: '80 000 km' },
  searchLabel: null, firstPrice: null, comparison: null, verification: null, sellerCheck: null, firstSeen: '2026-11-20 10:00:00',
  favorite: false, hidden: false, analysis: null, ...over,
});
const analysis = (verdict: Analysis['verdict']): Analysis => ({ verdict, score: 60 } as Analysis);
const typical = (ad: StoredAd) => predict(curve, new Date().getUTCFullYear() - year + 0.5, 80_000);

describe('viewAds', () => {
  const base = stored({ price: 1 });
  const curves = { [curveKey(base)!]: curve };
  const market = typical(base);

  it('marks a listing far under its market as striking, green, seller to check', () => {
    const [v] = viewAds([stored({ price: Math.round(market * 0.7) })], null, curves, null);
    expect(v.view.estimate?.basis).toBe('marche');
    expect(v.view.estimate!.discount).toBeGreaterThanOrEqual(25);
    expect(v.view.tone).toBe('good');
    expect(v.view.striking).toBe(true);
    expect(v.view.sellerFlag).toBe(true);
  });

  it('does not show a suspect listing in green', () => {
    const [v] = viewAds([stored({ price: Math.round(market * 0.7), analysis: analysis('suspect') })], null, curves, null);
    expect(v.view.tone).toBe('warn');
  });

  it('follows Leboncoin’s price rating for « pas une affaire », else our verdict', () => {
    const fair = stored({ price: 9000, attributes: { ...base.attributes, car_price_positioning: 'Prix équitable' } });
    const deal = stored({ price: 9000, attributes: { ...base.attributes, car_price_positioning: 'Bonne affaire' }, analysis: analysis('cher') });
    const pricey = stored({ price: 9000, analysis: analysis('cher') });
    const unknown = stored({ price: 9000 });
    expect(viewAds([fair, deal, pricey, unknown], null, curves, null).map((a) => a.view.notADeal)).toEqual([true, false, true, false]);
  });

  it('flags off-topic listings and new ones since the last collection', () => {
    const [off] = viewAds([stored({ price: 9000, analysis: analysis('hors_sujet') })], null, curves, '2026-11-20 09:00:00');
    expect(off.view.offTopic).toBe(true);
    expect(off.view.striking).toBe(false);
    expect(off.view.isNew).toBe(true);
    const [old] = viewAds([stored({ price: 9000 })], null, curves, '2026-11-21 09:00:00');
    expect(old.view.isNew).toBe(false);
  });

  it('gives the first message and the specs ready to show', () => {
    const [v] = viewAds([stored({ price: 9000 })], null, curves, null);
    expect(v.view.message).toMatch(/^Bonjour,/);
    expect(v.view.specs.map((f) => f.value.replace(/\s/g, ' '))).toContain('80 000 km');
    expect(v.view.mileage).toBe(80_000);
  });
});

describe('search pages and zone', () => {
  const brief = { id: 'b', title: '', prompt: '', zone: 'Rennes', locations: 'Rennes__48.1_-1.68_30000', updatedAt: '', lastCollectAt: null, includePros: false };
  const plan = {
    research: '', criteria: [], shortlist: [],
    searches: [{ label: 'S', pick: '', why: '', category: 2, text: 'duster', price_min: null, price_max: 9000, mileage_min: null, mileage_max: null, regdate_min: null, regdate_max: null, required_groups: [], exclude_keywords: [] }],
  } as unknown as Parameters<typeof searchPages>[0];

  it('builds the Leboncoin pages of each search with the hunt’s area and seller type', () => {
    const [pages] = searchPages(plan, brief);
    expect(pages).toHaveLength(2);
    expect(new URL(pages[0]).searchParams.get('owner_type')).toBe('private');
    expect(new URL(pages[1]).searchParams.get('page')).toBe('2');
    expect(new URL(searchPages(plan, { ...brief, includePros: true })[0][0]).searchParams.has('owner_type')).toBe(false);
  });

  it('says the area in words', () => {
    expect(zoneSummary(null)).toBe('toute la France');
    expect(zoneSummary('Rennes 30 km')).toBe('Rennes 30 km');
  });
});
