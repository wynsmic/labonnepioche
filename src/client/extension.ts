import { EXTENSION_ID } from '../shared/extension-id';
import type { Ad } from '../shared/types';

type FetchResult = { ok: true; ads: Ad[]; source: string | null; lists: string[] } | { ok: false; reason: string };

function send<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      reject(new Error('no-extension'));
      return;
    }
    chrome.runtime.sendMessage(EXTENSION_ID, message, (response: T) => {
      const err = chrome.runtime.lastError;
      if (err || response === undefined) reject(new Error(err?.message ?? 'no-extension'));
      else resolve(response);
    });
  });
}

/** True when the Affaires extension is installed in this Chrome. */
export async function extensionReady(): Promise<boolean> {
  try {
    const r = await send<{ ok: boolean }>({ type: 'ping' });
    return r.ok;
  } catch {
    return false;
  }
}

/** Opens the Leboncoin page in a background tab of this browser and returns its listings. */
export function fetchListings(url: string): Promise<FetchResult> {
  return send<FetchResult>({ type: 'fetch', url });
}


export type ProfileResult =
  | { ok: true; memberSince: string | null; totalAds: number | null; badges: string[]; ads: { title: string; price: number | null; category: string | null; date: string | null }[]; text: string }
  | { ok: false; reason: string };

/** Opens a seller's public Leboncoin profile in a background tab of this browser and reads it. */
export function readProfile(url: string): Promise<ProfileResult> {
  return send<ProfileResult>({ type: 'profile', url });
}

/** Opens a Leboncoin listing in a background tab of this browser and reads its seller's account id. */
export function readOwner(url: string): Promise<{ ok: true; sellerId: string } | { ok: false; reason: string }> {
  return send({ type: 'owner', url });
}

export type DetailResult =
  | {
      ok: true;
      id: string;
      body: string;
      price: number | null;
      sellerId: string | null;
      sellerName: string | null;
      attributes: Record<string, string>;
      /** The whole listing (extension 0.5.2+). */
      ad?: Ad;
    }
  | { ok: false; reason: string };

/** Opens a Leboncoin listing in a background tab of this browser and reads its full text and seller. */
export function readDetail(url: string): Promise<DetailResult> {
  return send<DetailResult>({ type: 'detail', url });
}

/** Opens Leboncoin's message form to the seller in a new tab of this browser and types the message in it. */
export function composeMessage(url: string, text: string): Promise<{ ok: true; filled: boolean } | { ok: false; reason: string }> {
  return send({ type: 'compose', url, text });
}
