// Runs inside a Leboncoin results page (chrome.scripting.executeScript), so it must be
// self-contained: no imports, no closure over outer variables.
// Reads the listings Leboncoin embeds in the page (Next.js `__NEXT_DATA__`).

/**
 * @returns {{ ok: true, ads: import('../src/shared/types').Ad[], source: string | null, lists: string[] } | { ok: false, reason: string }}
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
  // A page holds several lists of listings (results, "à la une", suggestions…): take the search
  // results (`searchData.ads`), else the largest list, and say which one was used.
  const lists = [];
  collectLists(data, '', 0, lists);
  if (!lists.length) return { ok: true, ads: [], source: null, lists: [] };
  const chosen =
    lists.find((l) => /(^|\.)searchData\.ads$/.test(l.path)) ??
    lists.find((l) => /searchData/.test(l.path)) ??
    [...lists].sort((x, y) => y.items.length - x.items.length)[0];
  return {
    ok: true,
    ads: chosen.items.map(mapAd).filter(Boolean),
    source: chosen.path,
    lists: lists.map((l) => `${l.path} (${l.items.length})`),
  };

  // --- helpers (kept inside so the function stays self-contained) ---

  /** Every array whose items look like listings (have list_id and subject), with its path. */
  function collectLists(node, path, depth, out) {
    if (!node || depth > 14 || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      if (node.length && node.every((x) => x && typeof x === 'object' && 'list_id' in x && 'subject' in x)) {
        out.push({ path, items: node });
        return;
      }
      node.forEach((item, i) => collectLists(item, `${path}[${i}]`, depth + 1, out));
      return;
    }
    for (const key of Object.keys(node)) collectLists(node[key], path ? `${path}.${key}` : key, depth + 1, out);
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
      sellerId: raw.owner && raw.owner.user_id ? String(raw.owner.user_id) : null,
      sellerName: raw.owner && raw.owner.name ? String(raw.owner.name) : null,
      attributes,
    };
  }
}
