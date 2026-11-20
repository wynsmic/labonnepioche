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
