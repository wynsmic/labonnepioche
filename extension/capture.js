// Runs inside a car-valuation page (La Centrale "cote"), so it must be self-contained.
// Returns what the page holds (embedded data, structured data, visible text) so the app can
// read the valuation from it.

/** @returns {{ ok: true, url: string, title: string, nextData: string | null, jsonLd: string[], text: string } | { ok: false, reason: string }} */
export function capturePage() {
  if (document.querySelector('iframe[src*="captcha-delivery"], iframe[src*="datadome"], iframe[src*="captcha"]')) {
    return { ok: false, reason: 'captcha' };
  }
  const next = document.getElementById('__NEXT_DATA__');
  const jsonLd = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent ?? '');
  const text = document.body ? document.body.innerText : '';
  if (!text.trim() && !next) return { ok: false, reason: 'no-data' };
  return {
    ok: true,
    url: location.href,
    title: document.title,
    nextData: next?.textContent ? next.textContent.slice(0, 400_000) : null,
    jsonLd: jsonLd.map((j) => j.slice(0, 50_000)).slice(0, 10),
    text: text.slice(0, 40_000),
  };
}
