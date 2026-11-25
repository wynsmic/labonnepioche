import type { SellerCheck, ViewedAd } from '../contracts/types';
import { api } from './api';
import { extensionReady, readDetail, readOwner, readProfile } from './extension';

/** Reads the seller's public profile in this browser and has it judged. */
export async function checkSeller(briefId: string, ad: ViewedAd): Promise<SellerCheck> {
  // Seller already checked lately (this hunt or another): no Leboncoin read.
  let known = ad.sellerId ? await api.cachedSeller(briefId, ad.id) : null;
  if (known?.check) return known.check;
  if (!(await extensionReady())) {
    throw new Error('Extension La Bonne Pioche introuvable dans ce navigateur : installe-la ou recharge-la (chrome://extensions).');
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
    known = await api.cachedSeller(briefId, ad.id, sellerId);
    if (known.check) return known.check;
  }
  if (!known?.profileUrl) throw new Error('Profil du vendeur introuvable.');
  const page = await readProfile(known.profileUrl);
  if (!page.ok) {
    throw new Error(
      page.reason === 'unknown-message' || page.reason === 'captcha' ? message(page.reason) : `Profil du vendeur illisible (${page.reason}).`,
    );
  }
  return api.sellerCheck(briefId, ad.id, { ...page, sellerId });
}

/** Checks the sellers of the striking deals not checked yet (a few, paced). */
export async function checkStrikingSellers(briefId: string, log: (line: string) => void, max = 8): Promise<void> {
  const { ads, sellerCheckDiscount } = await api.brief(briefId);
  const todo = ads.filter((a) => a.view.striking && !a.sellerCheck).slice(0, max);
  if (!todo.length) return;
  log(`Vérification des vendeurs de ${todo.length} affaire(s) à plus de ${sellerCheckDiscount} % sous le marché…`);
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
 * results carry no description), paced, and sends texts by small groups. Already read pages (30
 * days, any hunt) are skipped by the server. Stops on a Leboncoin check.
 */
export async function readDetails(briefId: string, log: (line: string) => void, alive: () => boolean = () => true): Promise<number> {
  const { ads } = await api.detailsNeeded(briefId);
  if (!ads.length) return 0;
  if (!(await extensionReady())) throw new Error('Extension La Bonne Pioche introuvable dans ce navigateur.');
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

/**
 * A listing chosen by hand: read through the extension (its page carries everything, text
 * included), added to the hunt as a favourite (kept by collections), then analysed like the others.
 */
export async function addListingByUrl(briefId: string, input: string): Promise<string> {
  const { url } = await api.listingUrl(input);
  if (!(await extensionReady())) throw new Error('Extension La Bonne Pioche introuvable dans ce navigateur.');
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
