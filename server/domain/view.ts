import type { AdView, Brief, Plan, PriceCurve, StoredAd, Tone, ViewedAd } from '../../contracts/types';
import { comparableQuery, numberFrom } from './compare';
import { estimateAll, type Estimate } from './estimate';
import { buildSearchUrl } from './leboncoin';
import { sellerMessage } from './message';
import { keyFacts, pickOf, trimOf } from './models';
import { describeCurve } from './pricing';
import { SELLER_CHECK_DISCOUNT, profileUrl } from './seller';
import { verdictOf } from './verdict';
import { parseZone } from './zone';

/** Leboncoin result pages read per planned search at each collection. */
export const PAGES_PER_SEARCH = 2;

/** A gap this large (in %) under the market shows green. */
const GOOD_DEAL = 10;

const fold = (t: string) => t.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

/**
 * Not a deal: Leboncoin rates the price fair or higher; or, when Leboncoin gives no verdict (no
 * estimate for that car, its choice, not the deal's), our verdict says « correct » or « cher ».
 * Listings not analysed yet are not ruled out.
 */
function notADeal(ad: StoredAd, verdict: AdView['verdict']): boolean {
  const lbc = fold(ad.attributes.car_price_positioning ?? '');
  if (/bonne affaire/.test(lbc)) return false;
  if (/equitable|superieur|au-dessus/.test(lbc)) return true;
  return verdict?.verdict === 'correct' || verdict?.verdict === 'cher';
}

/** A big discount on a suspect listing is not good news: no green then. */
function toneOf(estimate: Estimate | null, verdict: AdView['verdict']): Tone {
  if (!estimate) return 'none';
  if (verdict?.verdict === 'suspect') return 'warn';
  return estimate.discount >= GOOD_DEAL ? 'good' : estimate.discount < 0 ? 'bad' : 'neutral';
}

/** Everything the page shows about each listing, decided here once. */
export function viewAds(ads: StoredAd[], plan: Plan | null, curves: Record<string, PriceCurve>, lastCollectAt: string | null): ViewedAd[] {
  const estimates = estimateAll(ads, plan, curves);
  return ads.map((ad) => {
    const verdict = verdictOf(ad);
    const offTopic = verdict?.verdict === 'hors_sujet';
    const estimate = estimates.get(ad.id) ?? null;
    const pick = offTopic ? null : pickOf(plan, ad);
    const striking = !offTopic && ad.price != null && (estimate?.discount ?? -Infinity) >= SELLER_CHECK_DISCOUNT;
    const category = plan?.searches.find((s) => s.label === ad.searchLabel)?.category ?? 2;
    const c = ad.comparison;
    // Queries of older comparisons (no `pick`) were narrow (±1 year, ±30 % km): the wide curve search replaces them.
    const compareQuery = c?.query && c.query.pick !== undefined ? { ...c.query, required_groups: c.query.required_groups ?? [] } : comparableQuery(ad, category);
    const view: AdView = {
      verdict,
      estimate,
      tone: toneOf(estimate, verdict),
      model: pick ? { name: pick.name, tagline: pick.tagline ?? null, tags: pick.tags ?? [] } : null,
      trim: trimOf(ad, pick),
      specs: keyFacts(ad, pick),
      year: numberFrom(ad.attributes.regdate),
      mileage: numberFrom(ad.attributes.mileage),
      offTopic,
      notADeal: notADeal(ad, verdict),
      striking,
      // Shown on every listing far under its market (off-topic ones too), unlike the automatic check.
      sellerFlag: (estimate?.discount ?? 0) >= SELLER_CHECK_DISCOUNT || verdict?.verdict === 'suspect',
      message: sellerMessage(ad),
      compareQuery,
      nationalUrl: c ? buildSearchUrl(c.query, null) : null,
      curveText: c?.curve ? ('alpha' in c.curve ? describeCurve(c.curve) : 'ancienne loi de décote') : null,
      sellerProfileUrl: ad.sellerId ? profileUrl(ad.sellerId) : null,
      isNew: lastCollectAt != null && ad.firstSeen >= lastCollectAt,
    };
    return { ...ad, view };
  });
}

/** The Leboncoin pages each planned search reads (area and seller type of the hunt). */
export function searchPages(plan: Plan | null, brief: Brief): string[][] {
  return (plan?.searches ?? []).map((s) =>
    Array.from({ length: PAGES_PER_SEARCH }, (_, i) => buildSearchUrl(s, brief.locations, i + 1, { pros: brief.includePros })),
  );
}

/** The area as actually searched: radius per town (Leboncoin's maximum is 200 km). */
export function zoneSummary(zone: string | null): string {
  if (!zone) return 'toute la France';
  if (/^https?:/i.test(zone.trim())) return 'zone d’une recherche Leboncoin';
  const places = parseZone(zone);
  if (!places.length) return zone;
  return places.map((p) => `${p.name} ${p.radiusKm} km${/(\d{3,})\s*km/i.test(zone) && p.radiusKm === 200 ? ' (max.)' : ''}`).join(', ');
}
