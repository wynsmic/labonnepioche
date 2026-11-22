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
