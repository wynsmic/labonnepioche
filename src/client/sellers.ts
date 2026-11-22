import { estimateAll, type KnownPrices } from '../shared/estimate';
import { SELLER_CHECK_DISCOUNT, profileUrl, type SellerCheck } from '../shared/seller';
import { verdictOf, type StoredAd } from '../shared/types';
import { api } from './api';
import { readProfile } from './extension';

export function knownPrices(ads: StoredAd[]): Map<string, KnownPrices> {
  return new Map(
    ads.map((a) => [
      a.id,
      {
        // Only comparisons adjusted to the listing's year and mileage are a fair reference.
        france: a.comparison?.adjustedTo ? { median: a.comparison.median, count: a.comparison.count } : null,
        market: a.analysis?.market_price ?? null,
        newPrice: a.analysis?.new_price ?? null,
      },
    ]),
  );
}

/** Listings priced at least SELLER_CHECK_DISCOUNT % under their market: their seller deserves a look. */
export function strikingDeals(ads: StoredAd[]): StoredAd[] {
  const estimates = estimateAll(ads, knownPrices(ads));
  return ads.filter((ad) => {
    if (!ad.sellerId || ad.price == null || verdictOf(ad)?.verdict === 'hors_sujet') return false;
    const fromRules = estimates.get(ad.id)?.discount ?? null;
    const market = ad.analysis?.market_price;
    const fromAi = market ? Math.round(((market - ad.price) / market) * 100) : null;
    return Math.max(fromRules ?? -Infinity, fromAi ?? -Infinity) >= SELLER_CHECK_DISCOUNT;
  });
}

/** Reads the seller's public profile in this browser and has it judged. */
export async function checkSeller(briefId: string, ad: StoredAd): Promise<SellerCheck> {
  if (!ad.sellerId) throw new Error('Vendeur inconnu pour cette annonce : relance « Récupérer les annonces ».');
  const page = await readProfile(profileUrl(ad.sellerId));
  if (!page.ok) {
    throw new Error(
      page.reason === 'unknown-message'
        ? 'Recharge l’extension (version 0.3) dans chrome://extensions.'
        : page.reason === 'captcha'
          ? 'Leboncoin a demandé une vérification. Réessaie dans un moment.'
          : `Profil du vendeur illisible (${page.reason}).`,
    );
  }
  return api.sellerCheck(briefId, ad.id, page);
}

/** Checks the sellers of the striking deals not checked yet (a few, paced). */
export async function checkStrikingSellers(briefId: string, log: (line: string) => void, max = 8): Promise<void> {
  const { ads } = await api.brief(briefId);
  const todo = strikingDeals(ads).filter((a) => !a.sellerCheck).slice(0, max);
  if (!todo.length) return;
  log(`Vérification des vendeurs de ${todo.length} affaire(s) à plus de ${SELLER_CHECK_DISCOUNT} % sous le marché…`);
  for (const [i, ad] of todo.entries()) {
    try {
      const check = await checkSeller(briefId, ad);
      if (check.level !== 'ok') log(`⚠ ${ad.title} : ${check.flags.join(' · ')}`);
    } catch (e) {
      log(`Vendeur de « ${ad.title} » : ${(e as Error).message}`);
      if (/vérification|extension/.test((e as Error).message)) return;
    }
    if (i < todo.length - 1) await new Promise((r) => setTimeout(r, 3_000 + Math.random() * 3_000));
  }
}
