import type { Ad } from '../contracts/types';

/** Archive of the listings: their texts, facts and verdicts are kept and reused for a month. */
export const ARCHIVE_DAYS = 30;
/** Market freshness: a model's national search (and its price curve) is read again after this. */
export const MARKET_DAYS = 15;
/** A seller's profile check is read again after this (accounts change faster than cars). */
export const SELLER_DAYS = 15;

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const cutoff = () => daysAgo(ARCHIVE_DAYS);

/** FNV-1a, enough to tell that a text changed. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + text.length.toString(36);
}

/** A change of price or description voids the analysis. */
export const fingerprint = (ad: Pick<Ad, 'price' | 'body'>) => hash(`${ad.price ?? ''}|${ad.body}`);
/** The demand the listing was judged against. */
export const promptKey = (prompt: string) => hash(prompt.trim());

type Fields = Partial<{
  prompt_key: string;
  analysis: string;
  analysed_at: string;
  verification: string;
  comparison: string | null;
  verified_at: string;
  seller_id: string;
}>;

/** Remembers part of what is known about listings (other fields kept while the listing is unchanged). */
export async function remember(db: D1Database, briefId: string, items: { ad: Ad; fields: Fields }[]): Promise<void> {
  if (!items.length) return;
  const keep = (col: string) =>
    `${col} = CASE WHEN ad_cache.fingerprint = excluded.fingerprint THEN COALESCE(excluded.${col}, ad_cache.${col}) ELSE excluded.${col} END`;
  const statement = db.prepare(
    `INSERT INTO ad_cache (brief_id, ad_id, fingerprint, prompt_key, analysis, analysed_at, verification, comparison, verified_at, seller_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (brief_id, ad_id) DO UPDATE SET
       ${['prompt_key', 'analysis', 'analysed_at', 'verification', 'comparison', 'verified_at'].map(keep).join(',\n       ')},
       seller_id = COALESCE(excluded.seller_id, ad_cache.seller_id),
       fingerprint = excluded.fingerprint`,
  );
  const stmts = items.map(({ ad, fields: f }) =>
    statement.bind(
      briefId,
      ad.id,
      fingerprint(ad),
      f.prompt_key ?? null,
      f.analysis ?? null,
      f.analysed_at ?? null,
      f.verification ?? null,
      f.comparison ?? null,
      f.verified_at ?? null,
      f.seller_id ?? ad.sellerId ?? null,
    ),
  );
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
}

export async function rememberSeller(db: D1Database, sellerId: string, result: unknown): Promise<void> {
  await db.batch([
    db
      .prepare('INSERT OR REPLACE INTO seller_cache (seller_id, result, created_at) VALUES (?, ?, ?)')
      .bind(sellerId, JSON.stringify(result), new Date().toISOString()),
    db.prepare('DELETE FROM seller_cache WHERE created_at < ?').bind(daysAgo(SELLER_DAYS)),
  ]);
}

export async function cachedSeller<T>(db: D1Database, sellerId: string): Promise<T | null> {
  const row = await db
    .prepare('SELECT result FROM seller_cache WHERE seller_id = ? AND created_at > ?')
    .bind(sellerId, daysAgo(SELLER_DAYS))
    .first<{ result: string }>();
  return row ? (JSON.parse(row.result) as T) : null;
}

/**
 * Gives the hunt's listings back what was learnt less than ARCHIVE_DAYS ago: analysis and check
 * (same listing, same demand), national comparison (same listing), seller id and seller check.
 * Returns how many listings got something back.
 */
export async function restore(db: D1Database, briefId: string, prompt: string): Promise<number> {
  const key = promptKey(prompt);
  const since = cutoff();
  const { results: ads } = await db
    .prepare(
      `SELECT id, data, analysis IS NULL AS no_analysis, verification IS NULL AS no_verification,
              comparison IS NULL AS no_comparison, seller_check IS NULL AS no_seller
       FROM ads WHERE brief_id = ? AND (analysis IS NULL OR verification IS NULL OR comparison IS NULL OR seller_check IS NULL)`,
    )
    .bind(briefId)
    .all<{ id: string; data: string; no_analysis: number; no_verification: number; no_comparison: number; no_seller: number }>();
  if (!ads.length) return 0;
  const { results: rows } = await db
    .prepare('SELECT * FROM ad_cache WHERE brief_id = ?')
    .bind(briefId)
    .all<{
      ad_id: string;
      fingerprint: string;
      prompt_key: string | null;
      analysis: string | null;
      analysed_at: string | null;
      verification: string | null;
      comparison: string | null;
      verified_at: string | null;
      seller_id: string | null;
    }>();
  const cache = new Map(rows.map((r) => [r.ad_id, r]));

  const stmts: D1PreparedStatement[] = [];
  const sellers = new Map<string, string | null>();
  for (const row of ads) {
    const ad = JSON.parse(row.data) as Ad;
    const c = cache.get(ad.id);
    const same = c?.fingerprint === fingerprint(ad);
    const sameDemand = same && c?.prompt_key === key;
    const set: string[] = [];
    const values: unknown[] = [];
    if (row.no_analysis && sameDemand && c?.analysis && (c.analysed_at ?? '') > since) {
      set.push('analysis = ?');
      values.push(c.analysis);
    }
    if (same && c?.verified_at && c.verified_at > since) {
      if (row.no_verification && sameDemand && c.verification) {
        set.push('verification = ?');
        values.push(c.verification);
      }
      if (row.no_comparison && c.comparison) {
        set.push('comparison = ?');
        values.push(c.comparison);
      }
    }
    const sellerId = ad.sellerId ?? c?.seller_id ?? null;
    if (!ad.sellerId && sellerId) {
      set.push("data = json_set(data, '$.sellerId', ?)");
      values.push(sellerId);
    }
    if (row.no_seller && sellerId) {
      if (!sellers.has(sellerId)) {
        const hit = await db
          .prepare('SELECT result FROM seller_cache WHERE seller_id = ? AND created_at > ?')
          .bind(sellerId, since)
          .first<{ result: string }>();
        sellers.set(sellerId, hit?.result ?? null);
      }
      const check = sellers.get(sellerId);
      if (check) {
        set.push('seller_check = ?');
        values.push(check);
      }
    }
    if (set.length) {
      stmts.push(db.prepare(`UPDATE ads SET ${set.join(', ')} WHERE brief_id = ? AND id = ?`).bind(...values, briefId, ad.id));
    }
  }
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  return stmts.length;
}
