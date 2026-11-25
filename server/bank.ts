import { firstNumber, isMetropolitan } from './domain/leboncoin';
import type { Ad, Search } from '../contracts/types';
import { ARCHIVE_DAYS } from './cache';

/**
 * The bank of every listing read on Leboncoin (collections and national comparisons), shared by
 * all hunts: a listing of a hunt's list can be a comparable of another one. Kept ARCHIVE_DAYS.
 */

const lower = (v: string | undefined) => (v ? v.trim().toLowerCase() : null);
const brandOf = (ad: Ad) => lower(ad.attributes.brand ?? ad.attributes.u_car_brand);
const modelOf = (ad: Ad) => lower(ad.attributes.model ?? ad.attributes.u_car_model);

export async function bankAds(db: D1Database, ads: Ad[], seenAt: string): Promise<void> {
  if (!ads.length) return;
  const statement = db.prepare(
    `INSERT INTO ad_bank (id, data, brand, model, first_seen, seen_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET data = excluded.data, brand = excluded.brand, model = excluded.model, seen_at = excluded.seen_at`,
  );
  const unique = [...new Map(ads.map((a) => [a.id, a])).values()];
  const stmts = unique.map((ad) => statement.bind(ad.id, JSON.stringify(ad), brandOf(ad), modelOf(ad), seenAt, seenAt));
  // Housekeeping: listings not seen for longer than the archive period are dropped.
  stmts.push(db.prepare('DELETE FROM ad_bank WHERE seen_at < ?').bind(new Date(Date.now() - (ARCHIVE_DAYS + 1) * 86_400_000).toISOString()));
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
}

/**
 * Listings of the bank read less than ARCHIVE_DAYS ago that fit the comparison search: same make
 * and model, within its year, mileage and price ranges, in mainland France.
 * Returns them with when the oldest of them was read.
 */
export async function bankCandidates(db: D1Database, ad: Ad, query: Search): Promise<{ ads: Ad[]; oldest: string | null }> {
  const brand = brandOf(ad);
  const model = modelOf(ad);
  if (!brand || !model) return { ads: [], oldest: null };
  const since = new Date(Date.now() - ARCHIVE_DAYS * 86_400_000).toISOString();
  const { results } = await db
    .prepare('SELECT data, seen_at FROM ad_bank WHERE brand = ? AND model = ? AND seen_at > ? AND id != ?')
    .bind(brand, model, since, ad.id)
    .all<{ data: string; seen_at: string }>();
  const within = (v: number | null, min: number | null, max: number | null) =>
    v == null || ((min == null || v >= min) && (max == null || v <= max));
  const fits = results.filter(({ data }) => {
    const c = JSON.parse(data) as Ad;
    const year = firstNumber(c.attributes.regdate);
    return (
      isMetropolitan(c) &&
      within(c.price, query.price_min, query.price_max) &&
      within(year ? Number(String(year).slice(0, 4)) : null, query.regdate_min, query.regdate_max) &&
      within(firstNumber(c.attributes.mileage), query.mileage_min, query.mileage_max)
    );
  });
  return {
    ads: fits.map((r) => JSON.parse(r.data) as Ad),
    oldest: fits.reduce<string | null>((min, r) => (min == null || r.seen_at < min ? r.seen_at : min), null),
  };
}

const freshSince = () => new Date(Date.now() - ARCHIVE_DAYS * 86_400_000).toISOString();

/** Of these listings, those whose page was not read in the last ARCHIVE_DAYS (text unknown). */
export async function withoutDetail(db: D1Database, ids: string[]): Promise<Set<string>> {
  const missing = new Set(ids);
  const since = freshSince();
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const { results } = await db
      .prepare(`SELECT id FROM ad_bank WHERE detail_at > ? AND id IN (${chunk.map(() => '?').join(',')})`)
      .bind(since, ...chunk)
      .all<{ id: string }>();
    results.forEach((r) => missing.delete(r.id));
  }
  return missing;
}

/** The seller's texts already read (last ARCHIVE_DAYS), to keep them when search results bring the listing back without it. */
export async function knownTexts(db: D1Database, ids: string[]): Promise<Map<string, { body: string; sellerId: string | null }>> {
  const out = new Map<string, { body: string; sellerId: string | null }>();
  const since = freshSince();
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const { results } = await db
      .prepare(`SELECT id, body, json_extract(data, '$.sellerId') AS seller FROM ad_bank WHERE detail_at > ? AND id IN (${chunk.map(() => '?').join(',')})`)
      .bind(since, ...chunk)
      .all<{ id: string; body: string | null; seller: string | null }>();
    for (const r of results) if (r.body != null) out.set(r.id, { body: r.body, sellerId: r.seller });
  }
  return out;
}

/** Stores what the listing pages said (text, seller); facts are read again for a changed text. */
export async function bankDetails(
  db: D1Database,
  details: { id: string; body: string; sellerId: string | null; sellerName: string | null }[],
  at: string,
): Promise<void> {
  const statement = db.prepare(
    `UPDATE ad_bank SET
       facts = CASE WHEN body IS NOT ? THEN NULL ELSE facts END,
       facts_at = CASE WHEN body IS NOT ? THEN NULL ELSE facts_at END,
       body = ?, detail_at = ?,
       data = json_set(data, '$.body', ?, '$.sellerId', COALESCE(?, json_extract(data, '$.sellerId')), '$.sellerName', COALESCE(?, json_extract(data, '$.sellerName')))
     WHERE id = ?`,
  );
  const stmts = details.map((d) => statement.bind(d.body, d.body, d.body, at, d.body, d.sellerId, d.sellerName, d.id));
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
}

/** Of these listings, those with a known text but no facts read from it yet. */
export async function withoutFacts(db: D1Database, ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const { results } = await db
      .prepare(`SELECT id FROM ad_bank WHERE detail_at IS NOT NULL AND facts IS NULL AND id IN (${chunk.map(() => '?').join(',')})`)
      .bind(...chunk)
      .all<{ id: string }>();
    results.forEach((r) => out.add(r.id));
  }
  return out;
}

export async function saveFacts(db: D1Database, facts: { id: string }[], at: string): Promise<void> {
  const statement = db.prepare('UPDATE ad_bank SET facts = ?, facts_at = ? WHERE id = ?');
  const stmts = facts.map((f) => statement.bind(JSON.stringify(f), at, f.id));
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
}

/** Facts of bank listings (for the curve fit: wrecks and doubtful mileages left out). */
export async function factsOf(db: D1Database, ids: string[]): Promise<Map<string, import('../contracts/types').Facts>> {
  const out = new Map<string, import('../contracts/types').Facts>();
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const { results } = await db
      .prepare(`SELECT id, facts FROM ad_bank WHERE facts IS NOT NULL AND id IN (${chunk.map(() => '?').join(',')})`)
      .bind(...chunk)
      .all<{ id: string; facts: string }>();
    for (const r of results) out.set(r.id, JSON.parse(r.facts));
  }
  return out;
}

/** Every bank listing of a make and model read in the last ARCHIVE_DAYS (any hunt, any search). */
export async function bankModel(db: D1Database, brand: string, model: string): Promise<Ad[]> {
  const { results } = await db
    .prepare('SELECT data FROM ad_bank WHERE brand = ? AND model = ? AND seen_at > ?')
    .bind(brand.trim().toLowerCase(), model.trim().toLowerCase(), freshSince())
    .all<{ data: string }>();
  return results.map((r) => JSON.parse(r.data) as Ad);
}
