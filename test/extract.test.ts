import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractAdsFromPage } from '../extension/extract.js';

/** Shape of what Leboncoin embeds in __NEXT_DATA__ (trimmed). */
const nextData = {
  props: {
    pageProps: {
      searchData: {
        total: 2,
        ads: [
          {
            list_id: 2861234567,
            subject: 'Toyota Yaris hybride 2016',
            body: 'Entretien Toyota, 98 000 km.',
            price: [9500],
            first_publication_date: '2026-11-18 09:12:00',
            url: 'https://www.leboncoin.fr/ad/voitures/2861234567',
            location: { city: 'Rennes', zipcode: '35000', lat: 48.11, lng: -1.68 },
            images: { thumb_url: 'https://img.leboncoin.fr/thumb.jpg' },
            owner: { type: 'private', user_id: 'b29840b3-1ee2-4e16-86dd-abf9d2529b56', name: 'Jean' },
            attributes: [
              { key: 'mileage', value: '98000', value_label: '98000 km' },
              { key: 'regdate', value: '2016', value_label: '2016' },
              { key: 'fuel', value: '6', value_label: 'Hybride' },
            ],
          },
          {
            list_id: 42,
            subject: 'Sans prix ni lieu',
            url: '/ad/voitures/42',
            owner: { type: 'pro' },
          },
        ],
      },
    },
  },
};

function fakeDocument(script: { textContent: string } | null, captcha = false) {
  vi.stubGlobal('document', {
    getElementById: (id: string) => (id === '__NEXT_DATA__' ? script : null),
    querySelector: () => (captcha ? {} : null),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('extractAdsFromPage', () => {
  it('reads listings from the embedded page data', () => {
    fakeDocument({ textContent: JSON.stringify(nextData) });
    const result = extractAdsFromPage();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ads).toHaveLength(2);
    expect(result.ads[0]).toEqual({
      id: '2861234567',
      url: 'https://www.leboncoin.fr/ad/voitures/2861234567',
      title: 'Toyota Yaris hybride 2016',
      body: 'Entretien Toyota, 98 000 km.',
      price: 9500,
      date: '2026-11-18 09:12:00',
      city: 'Rennes',
      zipcode: '35000',
      lat: 48.11,
      lng: -1.68,
      image: 'https://img.leboncoin.fr/thumb.jpg',
      seller: 'private',
      sellerId: 'b29840b3-1ee2-4e16-86dd-abf9d2529b56',
      sellerName: 'Jean',
      attributes: { mileage: '98000 km', regdate: '2016', fuel: 'Hybride' },
    });
    expect(result.ads[1]).toMatchObject({
      id: '42',
      url: 'https://www.leboncoin.fr/ad/voitures/42',
      price: null,
      lat: null,
      seller: 'pro',
      sellerId: null,
      sellerName: null,
    });
  });

  it('reports a captcha page instead of results', () => {
    fakeDocument(null, true);
    expect(extractAdsFromPage()).toEqual({ ok: false, reason: 'captcha' });
  });

  it('reports pages without data', () => {
    fakeDocument(null);
    expect(extractAdsFromPage()).toEqual({ ok: false, reason: 'no-data' });
  });
});
