import { estimateAll } from '../shared/estimate';
import type { PriceCurve } from '../shared/pricing';
import { SELLER_CHECK_DISCOUNT, profileUrl, type SellerCheck } from '../shared/seller';
import { verdictOf, type Plan, type StoredAd } from '../shared/types';
import { api } from './api';
import { extensionReady, readDetail, readOwner, readProfile } from './extension';

/** Listings priced at least SELLER_CHECK_DISCOUNT % under their expected market price: their seller deserves a look. */
export function strikingDeals(ads: StoredAd[], plan: Plan | null | undefined, curves: Record<string, PriceCurve>): StoredAd[] {
  const estimates = estimateAll(ads, plan, curves);
  return ads.filter((ad) => {
    if (ad.price == null || verdictOf(ad)?.verdict === 'hors_sujet') return false;
    return (estimates.get(ad.id)?.discount ?? -Infinity) >= SELLER_CHECK_DISCOUNT;
  });
}

/** Reads the seller's public profile in this browser and has it judged. */
export async function checkSeller(briefId: string, ad: StoredAd): Promise<SellerCheck> {
  // Seller already checked in the last 15 days (this hunt or another): no Leboncoin read.
  if (ad.sellerId) {
    const cached = await api.cachedSeller(briefId, ad.id);
    if (cached) return cached;
  }
  if (!(await extensionReady())) {
    throw new Error('Extension Affaires introuvable dans ce navigateur : installe-la ou recharge-la (chrome://extensions).');
  }
  const message = (reason: string) =>
    reason === 'unknown-message'
      ? 'Recharge l’extension (version 0.4.1) dans chrome://extensions.'
      : reason === 'captcha'
        ? 'Leboncoin a demandé une vérification. Réessaie dans un moment.'
        : reason;
  // Listings read before the seller's id was collected: it is on the listing page.
  let sellerId = ad.sellerId ?? null;
  if (!sellerId) {
    const owner = await readOwner(ad.url);
    if (!owner.ok) throw new Error(`Vendeur introuvable sur l’annonce (${message(owner.reason)}).`);
    sellerId = owner.sellerId;
    const cached = await api.cachedSeller(briefId, ad.id, sellerId);
    if (cached) return cached;
  }
  const page = await readProfile(profileUrl(sellerId));
  if (!page.ok) {
    throw new Error(
      page.reason === 'unknown-message' || page.reason === 'captcha' ? message(page.reason) : `Profil du vendeur illisible (${page.reason}).`,
    );
  }
  return api.sellerCheck(briefId, ad.id, { ...page, sellerId });
}

/** Checks the sellers of the striking deals not checked yet (a few, paced). */
export async function checkStrikingSellers(briefId: string, log: (line: string) => void, max = 8): Promise<void> {
  const { ads, plan, curves } = await api.brief(briefId);
  const todo = strikingDeals(ads, plan?.plan, curves ?? {}).filter((a) => !a.sellerCheck).slice(0, max);
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

/**
 * Reads, through the extension, the page of every listing of the hunt whose text is unknown (search
 * results carry no description), paced, and sends texts by small groups. Already read pages (15
 * days, any hunt) are skipped by the server. Stops on a Leboncoin check.
 */
export async function readDetails(briefId: string, log: (line: string) => void, alive: () => boolean = () => true): Promise<number> {
  const { ads } = await api.detailsNeeded(briefId);
  if (!ads.length) return 0;
  if (!(await extensionReady())) throw new Error('Extension Affaires introuvable dans ce navigateur.');
  log(`Lecture du détail de ${ads.length} annonce(s) sur Leboncoin (texte du vendeur)…`);
  let pending: { id: string; body: string; sellerId: string | null; sellerName: string | null }[] = [];
  let read = 0;
  const flush = async () => {
    if (!pending.length) return;
    await api.saveDetails(briefId, pending);
    pending = [];
  };
  for (const [i, ad] of ads.entries()) {
    if (!alive()) break;
    const page = await readDetail(ad.url);
    if (page.ok) {
      pending.push({ id: ad.id, body: page.body, sellerId: page.sellerId, sellerName: page.sellerName });
      read++;
    } else if (page.reason === 'captcha') {
      await flush();
      throw new Error('Leboncoin a demandé une vérification : lecture des annonces interrompue, relance plus tard.');
    } else if (page.reason === 'unknown-message') {
      throw new Error('Recharge l’extension (version 0.4.1) dans chrome://extensions.');
    }
    if (pending.length >= 10) await flush();
    if ((i + 1) % 10 === 0) log(`… ${i + 1}/${ads.length} annonces lues`);
    if (i < ads.length - 1) await new Promise((r) => setTimeout(r, 1_500 + Math.random() * 1_500));
  }
  await flush();
  return read;
}

/** "https://www.leboncoin.fr/voitures/3313786723.htm?…" or ".../ad/voitures/3313786723" -> the listing page to read. */
export function listingUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (!/(^|\.)leboncoin\.fr$/.test(url.hostname)) return null;
  const id = url.pathname.match(/(\d{8,})/)?.[1];
  if (!id) return null;
  const category = url.pathname.split('/').filter(Boolean).find((p) => p !== 'ad' && !/\d/.test(p)) ?? 'voitures';
  return `https://www.leboncoin.fr/ad/${category}/${id}`;
}

/**
 * A listing chosen by hand: read through the extension (its page carries everything, text
 * included), added to the hunt as a favourite (kept by collections), then analysed like the others.
 */
export async function addListingByUrl(briefId: string, input: string): Promise<string> {
  const url = listingUrl(input);
  if (!url) throw new Error('Colle le lien d’une annonce Leboncoin (leboncoin.fr/…/123456789…).');
  if (!(await extensionReady())) throw new Error('Extension Affaires introuvable dans ce navigateur.');
  const page = await readDetail(url);
  if (!page.ok) {
    if (page.reason === 'captcha') throw new Error('Leboncoin a demandé une vérification : réessaie dans un moment.');
    if (page.reason === 'unknown-message') throw new Error('Recharge l’extension (version 0.5.2) dans chrome://extensions.');
    throw new Error(`Annonce illisible (${page.reason}).`);
  }
  if (!page.ad) throw new Error('Recharge l’extension (version 0.5.2) dans chrome://extensions.');
  await api.addAds(briefId, 'Ajout manuel', [page.ad]);
  await api.saveDetails(briefId, [{ id: page.ad.id, body: page.body, sellerId: page.sellerId, sellerName: page.sellerName }]);
  await api.flagAd(briefId, page.ad.id, { favorite: true });
  return page.ad.id;
}
