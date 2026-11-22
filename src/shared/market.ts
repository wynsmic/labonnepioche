import { numberFrom } from './compare';
import type { Ad } from './types';

const slug = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '+');

/** La Centrale valuation page for this make, model and year (null when the listing lacks them). */
export function laCentraleUrl(ad: Ad): string | null {
  const make = ad.attributes.brand ?? ad.attributes.u_car_brand;
  const model = ad.attributes.model ?? ad.attributes.u_car_model;
  const year = Number(String(numberFrom(ad.attributes.regdate) ?? '').slice(0, 4));
  if (!make || !model || !(year > 1950)) return null;
  return `https://www.lacentrale.fr/cote-voitures-${slug(make)}-${slug(model)}--${year}-.html`;
}
