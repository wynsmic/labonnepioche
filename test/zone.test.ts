import { describe, expect, it } from 'vitest';
import { parseZone, toLocationsParam } from '../src/shared/zone';

describe('parseZone', () => {
  it('splits places and reads optional radii', () => {
    expect(parseZone('Rennes 30 km, Saint-Malo; Vannes (20km)\nautour de Nantes et Brest')).toEqual([
      { name: 'Rennes', radiusKm: 30 },
      { name: 'Saint-Malo', radiusKm: 30 },
      { name: 'Vannes', radiusKm: 20 },
      { name: 'Nantes', radiusKm: 30 },
      { name: 'Brest', radiusKm: 30 },
    ]);
  });
  it('caps the radius and ignores empty parts', () => {
    expect(parseZone(' , Lyon 900 km ,')).toEqual([{ name: 'Lyon', radiusKm: 200 }]);
  });
});

describe('toLocationsParam', () => {
  it('uses Leboncoin\'s Town_Zip__lat_lng_radius_radius format, comma-separated', () => {
    expect(
      toLocationsParam([
        { name: 'Rennes', zip: '35000', lat: 48.1159, lng: -1.6884, radiusKm: 30 },
        { name: 'Saint Malo', zip: '35400', lat: 48.6465, lng: -2.0066, radiusKm: 10 },
      ]),
    ).toBe('Rennes_35000__48.1159_-1.6884_30000_30000,Saint-Malo_35400__48.6465_-2.0066_10000_10000');
  });
});
