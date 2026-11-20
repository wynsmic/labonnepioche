// Messages from the Affaires web app (externally_connectable):
//   { type: 'ping' }            -> { ok: true, version }
//   { type: 'fetch', url }      -> { ok: true, ads } | { ok: false, reason }
// Each fetch opens the Leboncoin page in a background tab of THIS browser, reads the
// listings it displays, then closes the tab. The app paces the requests.
import { extractAdsFromPage } from './extract.js';

const LOAD_TIMEOUT_MS = 30_000;
const CAPTCHA_TIMEOUT_MS = 120_000;

chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'ping') {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
    return false;
  }
  if (message?.type === 'fetch' && typeof message.url === 'string') {
    fetchListings(message.url)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, reason: String(err?.message ?? err) }));
    return true; // async response
  }
  sendResponse({ ok: false, reason: 'unknown-message' });
  return false;
});

async function fetchListings(url) {
  const parsed = new URL(url);
  // Only Leboncoin search result pages: never account pages (messages, favourites…).
  if (parsed.hostname !== 'www.leboncoin.fr' || parsed.pathname !== '/recherche') {
    return { ok: false, reason: 'not-a-search' };
  }

  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForLoad(tab.id, LOAD_TIMEOUT_MS);
    let result = await extract(tab.id);
    if (!result.ok && result.reason === 'captcha') {
      // Let the user solve the check in the tab, then read the page again.
      await chrome.tabs.update(tab.id, { active: true });
      const deadline = Date.now() + CAPTCHA_TIMEOUT_MS;
      while (!result.ok && Date.now() < deadline) {
        await sleep(3_000);
        // The page reloads after the check: reading it mid-navigation can throw.
        try {
          result = await extract(tab.id);
        } catch {
          result = { ok: false, reason: 'captcha' };
        }
      }
    }
    return result;
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function extract(tabId) {
  const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func: extractAdsFromPage });
  return injection?.result ?? { ok: false, reason: 'no-result' };
}

function waitForLoad(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('timeout'));
    }, timeoutMs);
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        // Give client-side rendering a moment.
        setTimeout(resolve, 1_500);
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    // The page may have finished loading before the listener was registered.
    chrome.tabs.get(tabId).then((t) => {
      if (t.status === 'complete') listener(tabId, { status: 'complete' });
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
