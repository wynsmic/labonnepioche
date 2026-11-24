// Runs inside a Leboncoin seller profile page (/profile/<id>/offers), so it must be self-contained.
// Reads what the page says about the seller (member since, verifications, number of listings)
// and the listings shown, from the visible text and the embedded Next.js data.

/** @returns {{ ok: true, memberSince: string | null, totalAds: number | null, badges: string[], ads: { title: string, price: number | null, category: string | null, date: string | null }[], text: string } | { ok: false, reason: string }} */
export function extractProfile() {
  if (document.querySelector('iframe[src*="captcha-delivery"], iframe[src*="datadome"], iframe[src*="captcha"]')) {
    return { ok: false, reason: 'captcha' };
  }
  const text = document.body ? document.body.innerText : '';
  if (!text.trim()) return { ok: false, reason: 'no-data' };

  const memberSince = (text.match(/Membre depuis\s+([^\n·|]{3,30})/i) || [])[1]?.trim() ?? null;
  const total = text.match(/(\d[\d\s]*)\s+annonces?\b/i);
  const badges = [
    /t[ée]l[ée]phone v[ée]rifi[ée]/i.test(text) ? 'téléphone vérifié' : null,
    /(pi[eè]ce d.identit[ée]|identit[ée]) v[ée]rifi[ée]e?/i.test(text) ? 'identité vérifiée' : null,
    /e-?mail v[ée]rifi[ée]/i.test(text) ? 'e-mail vérifié' : null,
  ].filter(Boolean);

  // Listings embedded in the page (same shape as search results).
  const lists = [];
  const script = document.getElementById('__NEXT_DATA__');
  if (script && script.textContent) {
    try {
      collect(JSON.parse(script.textContent), 0, lists);
    } catch {
      /* page without usable data: the text is still there */
    }
  }
  const seen = new Set();
  const ads = lists
    .flat()
    .filter((a) => a && a.list_id != null && !seen.has(a.list_id) && seen.add(a.list_id))
    .slice(0, 60)
    .map((a) => ({
      title: String(a.subject ?? ''),
      price: Array.isArray(a.price) ? a.price[0] ?? null : typeof a.price === 'number' ? a.price : null,
      category: a.category_name ?? null,
      date: a.first_publication_date ?? null,
    }));

  return {
    ok: true,
    memberSince,
    totalAds: total ? Number(total[1].replace(/\s/g, '')) : ads.length || null,
    badges,
    ads,
    text: text.slice(0, 3000),
  };

  function collect(node, depth, out) {
    if (!node || depth > 14 || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      if (node.length && node.every((x) => x && typeof x === 'object' && 'list_id' in x && 'subject' in x)) {
        out.push(node);
        return;
      }
      node.forEach((item) => collect(item, depth + 1, out));
      return;
    }
    for (const key of Object.keys(node)) collect(node[key], depth + 1, out);
  }
}

/**
 * Runs inside a Leboncoin listing page (/ad/...): the seller's account id, from the embedded data.
 * @returns {{ ok: true, sellerId: string } | { ok: false, reason: string }}
 */
export function extractOwner() {
  if (document.querySelector('iframe[src*="captcha-delivery"], iframe[src*="datadome"], iframe[src*="captcha"]')) {
    return { ok: false, reason: 'captcha' };
  }
  const script = document.getElementById('__NEXT_DATA__');
  if (!script || !script.textContent) return { ok: false, reason: 'no-data' };
  let data;
  try {
    data = JSON.parse(script.textContent);
  } catch {
    return { ok: false, reason: 'bad-json' };
  }
  const id = find(data, 0);
  return id ? { ok: true, sellerId: id } : { ok: false, reason: 'no-owner' };

  /** The `user_id` of the first `owner` object (the listing's seller). */
  function find(node, depth) {
    if (!node || depth > 14 || typeof node !== 'object') return null;
    if (!Array.isArray(node) && node.owner && typeof node.owner === 'object' && node.owner.user_id) {
      return String(node.owner.user_id);
    }
    for (const value of Array.isArray(node) ? node : Object.values(node)) {
      const found = find(value, depth + 1);
      if (found) return found;
    }
    return null;
  }
}

/**
 * Listing page: the seller's full text, the seller id and the attributes, from the page's
 * __NEXT_DATA__ (the search results do not carry the description). Runs inside the tab.
 */
export function extractDetail() {
  if (document.querySelector('iframe[src*="captcha-delivery"], iframe[src*="datadome"], iframe[src*="captcha"]')) {
    return { ok: false, reason: 'captcha' };
  }
  const script = document.getElementById('__NEXT_DATA__');
  if (!script || !script.textContent) return { ok: false, reason: 'no-data' };
  let data;
  try {
    data = JSON.parse(script.textContent);
  } catch {
    return { ok: false, reason: 'bad-json' };
  }
  const ad = find(data, 0);
  if (!ad) return { ok: false, reason: 'no-ad' };
  const attributes = {};
  for (const a of Array.isArray(ad.attributes) ? ad.attributes : []) {
    if (a && a.key) attributes[a.key] = String(a.value_label ?? a.value ?? '');
  }
  return {
    ok: true,
    id: String(ad.list_id),
    body: String(ad.body ?? ''),
    price: Array.isArray(ad.price) ? Number(ad.price[0]) : typeof ad.price === 'number' ? ad.price : null,
    sellerId: ad.owner && ad.owner.user_id ? String(ad.owner.user_id) : null,
    sellerName: ad.owner && ad.owner.name ? String(ad.owner.name) : null,
    attributes,
    // The whole listing, for one added by hand (same shape as a search result).
    ad: (() => {
      const loc = ad.location || {};
      const images = ad.images || {};
      const url = typeof ad.url === 'string' && ad.url ? ad.url : location.href.split('?')[0];
      return {
        id: String(ad.list_id),
        url: url.startsWith('http') ? url : `https://www.leboncoin.fr${url}`,
        title: String(ad.subject ?? ''),
        body: String(ad.body ?? ''),
        price: Array.isArray(ad.price) ? Number(ad.price[0]) : typeof ad.price === 'number' ? ad.price : null,
        date: ad.first_publication_date ?? ad.index_date ?? null,
        city: loc.city ?? null,
        zipcode: loc.zipcode ?? null,
        lat: typeof loc.lat === 'number' ? loc.lat : null,
        lng: typeof loc.lng === 'number' ? loc.lng : null,
        image: images.thumb_url ?? (Array.isArray(images.urls_thumb) ? images.urls_thumb[0] : null) ?? images.small_url ?? (Array.isArray(images.urls) ? images.urls[0] : null) ?? null,
        seller: ad.owner && ad.owner.type ? (ad.owner.type === 'pro' ? 'pro' : 'private') : null,
        sellerId: ad.owner && ad.owner.user_id ? String(ad.owner.user_id) : null,
        sellerName: ad.owner && ad.owner.name ? String(ad.owner.name) : null,
        attributes,
      };
    })(),
  };

  /** The listing object: the first one with a list_id and a body. */
  function find(node, depth) {
    if (!node || depth > 14 || typeof node !== 'object') return null;
    if (!Array.isArray(node) && node.list_id != null && typeof node.body === 'string') return node;
    for (const value of Array.isArray(node) ? node : Object.values(node)) {
      const found = find(value, depth + 1);
      if (found) return found;
    }
    return null;
  }
}
