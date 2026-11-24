import { expect, it } from 'vitest';
import { listingUrl } from '../src/client/sellers';

it('reads the listing page from any Leboncoin link', () => {
  expect(listingUrl('https://www.leboncoin.fr/ad/voitures/3313786723')).toBe('https://www.leboncoin.fr/ad/voitures/3313786723');
  expect(listingUrl('https://www.leboncoin.fr/voitures/3313786723.htm?utm=x')).toBe('https://www.leboncoin.fr/ad/voitures/3313786723');
  expect(listingUrl(' https://leboncoin.fr/ad/motos/3313786723 ')).toBe('https://www.leboncoin.fr/ad/motos/3313786723');
  expect(listingUrl('https://www.lacentrale.fr/auto-occasion-annonce-123456789.html')).toBeNull();
  expect(listingUrl('pas un lien')).toBeNull();
});
