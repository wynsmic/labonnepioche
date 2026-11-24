// Messages from the Affaires web app (externally_connectable):
//   { type: 'ping' }            -> { ok: true, version }
//   { type: 'fetch', url }      -> { ok: true, ads } | { ok: false, reason }
//   { type: 'profile', url }    -> { ok: true, memberSince, totalAds, badges, ads, text } | { ok: false, reason }
//                                  (public seller profile pages only)
//   { type: 'owner', url }      -> { ok: true, sellerId } | { ok: false, reason }   (listing pages only)
//   { type: 'compose', url, text } -> { ok: true, filled } | { ok: false, reason }   (opens Leboncoin's message form to the seller, fills it)
//   { type: 'detail', url }     -> { ok: true, id, body, price, sellerId, sellerName, attributes } | { ok: false, reason }   (listing pages only)
// Each fetch opens the Leboncoin page in a background tab of THIS browser, reads the
// listings it displays, then closes the tab. The app paces the requests.
import { extractAdsFromPage } from './extract.js';
import { extractDetail, extractOwner, extractProfile } from './profile.js';

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
  if (message?.type === 'profile' && typeof message.url === 'string') {
    readProfile(message.url)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, reason: String(err?.message ?? err) }));
    return true;
  }
  if (message?.type === 'owner' && typeof message.url === 'string') {
    readOwner(message.url)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, reason: String(err?.message ?? err) }));
    return true;
  }
  if (message?.type === 'compose' && typeof message.url === 'string' && typeof message.text === 'string') {
    compose(message.url, message.text)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, reason: String(err?.message ?? err) }));
    return true;
  }
  if (message?.type === 'detail' && typeof message.url === 'string') {
    readDetail(message.url)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, reason: String(err?.message ?? err) }));
    return true;
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

  return readInTab(url, extractAdsFromPage);
}

async function readProfile(url) {
  const parsed = new URL(url);
  // Only public seller profiles: never the user's own account pages.
  if (parsed.hostname !== 'www.leboncoin.fr' || !/^\/profile\/[\w-]+(\/offers)?\/?$/.test(parsed.pathname)) {
    return { ok: false, reason: 'not-a-profile' };
  }
  return readInTab(url, extractProfile);
}

async function readOwner(url) {
  const parsed = new URL(url);
  // Only listing pages.
  if (parsed.hostname !== 'www.leboncoin.fr' || !parsed.pathname.startsWith('/ad/')) {
    return { ok: false, reason: 'not-a-listing' };
  }
  return readInTab(url, extractOwner);
}

/**
 * Opens Leboncoin's message form for a listing in a visible tab and types the message in it (the
 * user reads it and presses send themselves). The tab stays open.
 */
async function compose(url, text) {
  const parsed = new URL(url);
  if (parsed.hostname !== 'www.leboncoin.fr' || !/^\/reply\/\d+\/?$/.test(parsed.pathname)) {
    return { ok: false, reason: 'not-a-reply-form' };
  }
  const tab = await chrome.tabs.create({ url, active: true });
  await waitForLoad(tab.id, LOAD_TIMEOUT_MS);
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    args: [text.slice(0, 4000)],
    func: async (message) => {
      // The form renders client-side: wait for its text area (absent when logged out).
      for (let i = 0; i < 40; i++) {
        const area = document.querySelector('textarea');
        if (area) {
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
          setter.call(area, message);
          area.dispatchEvent(new Event('input', { bubbles: true }));
          area.focus();
          return { ok: true, filled: true };
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      return { ok: true, filled: false };
    },
  });
  return injection?.result ?? { ok: true, filled: false };
}

async function readDetail(url) {
  const parsed = new URL(url);
  if (parsed.hostname !== 'www.leboncoin.fr' || !parsed.pathname.startsWith('/ad/')) {
    return { ok: false, reason: 'not-a-listing' };
  }
  return readInTab(url, extractDetail);
}

/** Opens the page in a background tab, runs `func` in it (bringing the tab forward for a captcha), closes it. */
async function readInTab(url, func) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForLoad(tab.id, LOAD_TIMEOUT_MS);
    let result = await run(tab.id, func);
    if (!result.ok && result.reason === 'captcha') {
      // Let the user solve the check in the tab, then read the page again.
      await chrome.tabs.update(tab.id, { active: true });
      const deadline = Date.now() + CAPTCHA_TIMEOUT_MS;
      while (!result.ok && Date.now() < deadline) {
        await sleep(3_000);
        // The page reloads after the check: reading it mid-navigation can throw.
        try {
          result = await run(tab.id, func);
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

async function run(tabId, func) {
  const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func });
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
