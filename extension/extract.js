// Runs inside a Leboncoin results page (chrome.scripting.executeScript), so it must be
// self-contained: no imports, no closure over outer variables.
// Reads the listings Leboncoin embeds in the page (Next.js `__NEXT_DATA__`).

/**
 * @returns {{ ok: true, ads: import('../src/shared/types').Ad[] } | { ok: false, reason: string }}
 */
export function extractAdsFromPage() {
  const script = document.getElementById('__NEXT_DATA__');
  if (!script || !script.textContent) {
    // DataDome shows a captcha page instead of the results.
    const captcha = !!document.querySelector('iframe[src*="captcha"], iframe[src*="datadome"]');
    return { ok: false, reason: captcha ? 'captcha' : 'no-data' };
  }
  let data;
  try {
    data = JSON.parse(script.textContent);
  } catch {
    return { ok: false, reason: 'bad-json' };
  }
  return { ok: true, ads: extractAds(data) };

  // --- helpers (kept inside so the function stays self-contained) ---
  function extractAds(root) {
    const list = findAdList(root, 0);
    return list ? list.map(mapAd).filter(Boolean) : [];
  }

  /** The first array whose items look like listings (have list_id and subject). */
  function findAdList(node, depth) {
    if (!node || depth > 12 || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      if (node.length && node.every((x) => x && typeof x === 'object' && 'list_id' in x && 'subject' in x)) {
        return node;
      }
      for (const item of node) {
        const found = findAdList(item, depth + 1);
        if (found) return found;
      }
      return null;
    }
    for (const key of Object.keys(node)) {
      const found = findAdList(node[key], depth + 1);
      if (found) return found;
    }
    return null;
  }

  function mapAd(raw) {
    if (!raw || raw.list_id == null) return null;
    const attributes = {};
    for (const a of Array.isArray(raw.attributes) ? raw.attributes : []) {
      if (a && a.key) attributes[a.key] = String(a.value_label ?? a.value ?? '');
    }
    const loc = raw.location || {};
    const images = raw.images || {};
    const price = Array.isArray(raw.price) ? raw.price[0] : raw.price_cents != null ? raw.price_cents / 100 : null;
    const url = typeof raw.url === 'string' && raw.url ? raw.url : `https://www.leboncoin.fr/ad/${raw.list_id}`;
    return {
      id: String(raw.list_id),
      url: url.startsWith('http') ? url : `https://www.leboncoin.fr${url}`,
      title: String(raw.subject ?? ''),
      body: String(raw.body ?? ''),
      price: typeof price === 'number' ? price : null,
      date: raw.first_publication_date ?? raw.index_date ?? null,
      city: loc.city ?? null,
      zipcode: loc.zipcode ?? null,
      lat: typeof loc.lat === 'number' ? loc.lat : null,
      lng: typeof loc.lng === 'number' ? loc.lng : null,
      image: images.thumb_url ?? (Array.isArray(images.urls_thumb) ? images.urls_thumb[0] : null) ?? images.small_url ?? null,
      seller: raw.owner && raw.owner.type ? (raw.owner.type === 'pro' ? 'pro' : 'private') : null,
      attributes,
    };
  }
}
