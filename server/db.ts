import type { Comparison } from './domain/compare';
import type { SellerCheck } from './domain/seller';
import type { Facts } from './domain/facts';
import type { Ad, Analysis, Brief, Plan, StoredAd, Verification } from '../contracts/types';

interface BriefRow {
  id: string;
  title: string;
  prompt: string;
  zone: string | null;
  locations: string | null;
  updated_at: string;
  last_collect_at: string | null;
  include_pros: number;
}

interface AdRow {
  id: string;
  data: string;
  search_label: string | null;
  first_seen: string;
  analysis: string | null;
  favorite: number;
  hidden: number;
  first_price: number | null;
  comparison: string | null;
  verification: string | null;
  seller_check: string | null;
  facts?: string | null;
  contacted_at?: string | null;
}

const toBrief = (r: BriefRow): Brief => ({
  id: r.id,
  title: r.title,
  prompt: r.prompt,
  zone: r.zone,
  locations: r.locations,
  updatedAt: r.updated_at,
  lastCollectAt: r.last_collect_at,
  includePros: r.include_pros === 1,
});

const toAd = (r: AdRow): StoredAd => ({
  ...(JSON.parse(r.data) as Ad),
  searchLabel: r.search_label,
  firstSeen: r.first_seen,
  firstPrice: r.first_price,
  comparison: r.comparison ? (JSON.parse(r.comparison) as Comparison) : null,
  verification: r.verification ? (JSON.parse(r.verification) as Verification) : null,
  sellerCheck: r.seller_check ? (JSON.parse(r.seller_check) as SellerCheck) : null,
  facts: r.facts ? (JSON.parse(r.facts) as Facts) : null,
  contactedAt: r.contacted_at ?? null,
  favorite: r.favorite === 1,
  hidden: r.hidden === 1,
  analysis: r.analysis ? (JSON.parse(r.analysis) as Analysis) : null,
});

export async function listBriefs(db: D1Database): Promise<Brief[]> {
  const { results } = await db
    .prepare('SELECT id, title, prompt, zone, locations, updated_at, last_collect_at, include_pros FROM briefs ORDER BY updated_at DESC')
    .all<BriefRow>();
  return results.map(toBrief);
}

export async function getBrief(db: D1Database, id: string): Promise<Brief | null> {
  const row = await db
    .prepare('SELECT id, title, prompt, zone, locations, updated_at, last_collect_at, include_pros FROM briefs WHERE id = ?')
    .bind(id)
    .first<BriefRow>();
  return row ? toBrief(row) : null;
}

export async function createBrief(
  db: D1Database,
  input: { title: string; prompt: string; zone: string | null; locations: string | null },
): Promise<Brief> {
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare('INSERT INTO briefs (id, title, prompt, zone, locations) VALUES (?, ?, ?, ?, ?)').bind(
      id,
      input.title,
      input.prompt,
      input.zone,
      input.locations,
    ),
    db.prepare('INSERT INTO prompt_versions (id, brief_id, prompt, note) VALUES (?, ?, ?, ?)').bind(
      crypto.randomUUID(),
      id,
      input.prompt,
      'Première version',
    ),
  ]);
  return (await getBrief(db, id))!;
}

/** Saves the changed fields; a changed prompt also becomes a new version. */
export async function updateBrief(
  db: D1Database,
  brief: Brief,
  patch: { title?: string; prompt?: string; zone?: { text: string | null; locations: string | null }; note?: string; includePros?: boolean },
): Promise<Brief> {
  const next = {
    title: patch.title ?? brief.title,
    prompt: patch.prompt ?? brief.prompt,
    zone: patch.zone ? patch.zone.text : brief.zone,
    locations: patch.zone ? patch.zone.locations : brief.locations,
    includePros: patch.includePros ?? brief.includePros,
  };
  const statements = [
    db
      .prepare(
        "UPDATE briefs SET title = ?, prompt = ?, zone = ?, locations = ?, include_pros = ?, updated_at = datetime('now') WHERE id = ?",
      )
      .bind(next.title, next.prompt, next.zone, next.locations, next.includePros ? 1 : 0, brief.id),
  ];
  if (patch.prompt !== undefined && patch.prompt !== brief.prompt) {
    statements.push(
      db
        .prepare('INSERT INTO prompt_versions (id, brief_id, prompt, note) VALUES (?, ?, ?, ?)')
        .bind(crypto.randomUUID(), brief.id, patch.prompt, patch.note ?? null),
    );
  }
  await db.batch(statements);
  return (await getBrief(db, brief.id))!;
}

export async function deleteBrief(db: D1Database, id: string): Promise<void> {
  // D1 enforces foreign keys, so children go first.
  await db.batch([
    db.prepare('DELETE FROM ads WHERE brief_id = ?').bind(id),
    db.prepare('DELETE FROM plans WHERE brief_id = ?').bind(id),
    db.prepare('DELETE FROM prompt_versions WHERE brief_id = ?').bind(id),
    db.prepare('DELETE FROM briefs WHERE id = ?').bind(id),
  ]);
}

export async function listVersions(db: D1Database, briefId: string) {
  const { results } = await db
    .prepare('SELECT id, prompt, note, created_at AS createdAt FROM prompt_versions WHERE brief_id = ? ORDER BY created_at DESC')
    .bind(briefId)
    .all<{ id: string; prompt: string; note: string | null; createdAt: string }>();
  return results;
}

export async function savePlan(db: D1Database, briefId: string, prompt: string, plan: Plan): Promise<void> {
  await db
    .prepare('INSERT INTO plans (id, brief_id, prompt, plan) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), briefId, prompt, JSON.stringify(plan))
    .run();
}

export async function latestPlan(db: D1Database, briefId: string): Promise<{ plan: Plan; createdAt: string } | null> {
  const row = await db
    .prepare('SELECT plan, created_at FROM plans WHERE brief_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
    .bind(briefId)
    .first<{ plan: string; created_at: string }>();
  return row ? { plan: JSON.parse(row.plan) as Plan, createdAt: row.created_at } : null;
}

export async function listAds(db: D1Database, briefId: string): Promise<StoredAd[]> {
  const { results } = await db
    .prepare(
      `SELECT a.id, a.data, a.search_label, a.first_seen, a.analysis, a.favorite, a.hidden, a.first_price, a.comparison,
              a.verification, a.seller_check, a.contacted_at, b.facts
       FROM ads a LEFT JOIN ad_bank b ON b.id = a.id
       WHERE a.brief_id = ? ORDER BY a.first_seen DESC`,
    )
    .bind(briefId)
    .all<AdRow>();
  return results.map(toAd);
}

/**
 * New listings are inserted; known ones get their fresh data. A changed price or text
 * invalidates the analysis, which then runs again.
 */
export async function upsertAds(
  db: D1Database,
  briefId: string,
  searchLabel: string | null,
  input: Ad[],
  seenAt: string,
): Promise<{ added: number; updated: number }> {
  // The same listing can appear twice on a page (sponsored ads).
  const ads = [...new Map(input.map((a) => [a.id, a])).values()];
  if (!ads.length) return { added: 0, updated: 0 };
  // D1 accepts at most 100 bound parameters per statement.
  const existing = new Set<string>();
  for (let i = 0; i < ads.length; i += 90) {
    const chunk = ads.slice(i, i + 90);
    const { results } = await db
      .prepare(`SELECT id FROM ads WHERE brief_id = ? AND id IN (${chunk.map(() => '?').join(',')})`)
      .bind(briefId, ...chunk.map((a) => a.id))
      .all<{ id: string }>();
    results.forEach((r) => existing.add(r.id));
  }
  const upsert = db.prepare(
    `INSERT INTO ads (brief_id, id, data, search_label, first_price, last_seen) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (brief_id, id) DO UPDATE SET
       last_seen = excluded.last_seen,
       search_label = excluded.search_label,
       analysis = CASE
         WHEN json_extract(ads.data, '$.price') IS NOT json_extract(excluded.data, '$.price')
           OR json_extract(ads.data, '$.body') IS NOT json_extract(excluded.data, '$.body')
         THEN NULL ELSE ads.analysis END,
       analysis_attempts = CASE
         WHEN json_extract(ads.data, '$.price') IS NOT json_extract(excluded.data, '$.price')
           OR json_extract(ads.data, '$.body') IS NOT json_extract(excluded.data, '$.body')
         THEN 0 ELSE ads.analysis_attempts END,
       verification = CASE
         WHEN json_extract(ads.data, '$.price') IS NOT json_extract(excluded.data, '$.price')
           OR json_extract(ads.data, '$.body') IS NOT json_extract(excluded.data, '$.body')
         THEN NULL ELSE ads.verification END,
       data = excluded.data`,
  );
  for (let i = 0; i < ads.length; i += 50) {
    await db.batch(
      ads.slice(i, i + 50).map((ad) => upsert.bind(briefId, ad.id, JSON.stringify(ad), searchLabel, ad.price, seenAt)),
    );
  }
  return { added: ads.length - existing.size, updated: existing.size };
}

/** Listings still to analyse: never analysed, visible, and not given up on. */
const TO_ANALYSE = 'brief_id = ? AND analysis IS NULL AND hidden = 0 AND analysis_attempts < 3';

export async function adsToAnalyse(db: D1Database, briefId: string, limit: number): Promise<Ad[]> {
  const { results } = await db
    .prepare(`SELECT data FROM ads WHERE ${TO_ANALYSE} ORDER BY analysis_attempts, first_seen LIMIT ?`)
    .bind(briefId, limit)
    .all<{ data: string }>();
  return results.map((r) => JSON.parse(r.data) as Ad);
}

export async function countToAnalyse(db: D1Database, briefId: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM ads WHERE ${TO_ANALYSE}`)
    .bind(briefId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Counts one attempt for every listing of the batch, and stores the analyses obtained. */
export async function saveAnalyses(
  db: D1Database,
  briefId: string,
  batchIds: string[],
  analyses: Analysis[],
): Promise<void> {
  if (!batchIds.length) return;
  await db.batch([
    ...batchIds.map((id) =>
      db.prepare('UPDATE ads SET analysis_attempts = analysis_attempts + 1 WHERE brief_id = ? AND id = ?').bind(briefId, id),
    ),
    ...analyses.map((a) =>
      db.prepare('UPDATE ads SET analysis = ? WHERE brief_id = ? AND id = ?').bind(JSON.stringify(a), briefId, a.id),
    ),
  ]);
}

export async function setAdFlags(
  db: D1Database,
  briefId: string,
  adId: string,
  flags: { favorite?: boolean; hidden?: boolean; contacted?: boolean },
): Promise<void> {
  if (flags.contacted !== undefined) {
    await db
      .prepare('UPDATE ads SET contacted_at = ? WHERE brief_id = ? AND id = ?')
      .bind(flags.contacted ? new Date().toISOString() : null, briefId, adId)
      .run();
  }
  if (flags.favorite !== undefined) {
    await db
      .prepare('UPDATE ads SET favorite = ? WHERE brief_id = ? AND id = ?')
      .bind(flags.favorite ? 1 : 0, briefId, adId)
      .run();
  }
  if (flags.hidden !== undefined) {
    await db
      .prepare('UPDATE ads SET hidden = ? WHERE brief_id = ? AND id = ?')
      .bind(flags.hidden ? 1 : 0, briefId, adId)
      .run();
  }
}

export async function getAd(db: D1Database, briefId: string, adId: string): Promise<Ad | null> {
  const row = await db
    .prepare('SELECT data FROM ads WHERE brief_id = ? AND id = ?')
    .bind(briefId, adId)
    .first<{ data: string }>();
  return row ? (JSON.parse(row.data) as Ad) : null;
}

export async function saveComparison(db: D1Database, briefId: string, adId: string, c: Comparison): Promise<void> {
  await db
    .prepare('UPDATE ads SET comparison = ? WHERE brief_id = ? AND id = ?')
    .bind(JSON.stringify(c), briefId, adId)
    .run();
}

/** Every listing goes back to the analysis queue (after a change in the rules). */
/** A new plan: verdicts (first analysis and price check) are stale; the price comparison stays (it does not depend on the demand). */
export async function resetAnalyses(db: D1Database, briefId: string): Promise<void> {
  await db.prepare('UPDATE ads SET analysis = NULL, analysis_attempts = 0, verification = NULL WHERE brief_id = ?').bind(briefId).run();
}

export async function saveVerification(
  db: D1Database,
  briefId: string,
  adId: string,
  comparison: Comparison | null,
  verification: Verification,
): Promise<void> {
  await db
    .prepare('UPDATE ads SET comparison = ?, verification = ? WHERE brief_id = ? AND id = ?')
    .bind(comparison ? JSON.stringify(comparison) : null, JSON.stringify(verification), briefId, adId)
    .run();
}


/** Drops the listings a collection started at `since` did not read again (favourites and listings of `keepLabels` searches stay). */
export async function pruneUnseen(db: D1Database, briefId: string, since: string, keepLabels: string[]): Promise<number> {
  const keep = keepLabels.length ? ` AND (search_label IS NULL OR search_label NOT IN (${keepLabels.map(() => '?').join(', ')}))` : '';
  const r = await db
    .prepare(`DELETE FROM ads WHERE brief_id = ? AND favorite = 0 AND (last_seen IS NULL OR last_seen < ?)${keep}`)
    .bind(briefId, since, ...keepLabels)
    .run();
  return r.meta.changes ?? 0;
}

export async function saveSellerCheck(db: D1Database, briefId: string, adId: string, check: SellerCheck): Promise<void> {
  await db.prepare('UPDATE ads SET seller_check = ? WHERE brief_id = ? AND id = ?').bind(JSON.stringify(check), briefId, adId).run();
}

export async function setSellerId(db: D1Database, briefId: string, adId: string, sellerId: string): Promise<void> {
  await db
    .prepare("UPDATE ads SET data = json_set(data, '$.sellerId', ?) WHERE brief_id = ? AND id = ?")
    .bind(sellerId, briefId, adId)
    .run();
}

/** First call of a collection run: its start becomes the "new listing" threshold. */
export async function markCollectRun(db: D1Database, briefId: string, run: string): Promise<void> {
  await db
    .prepare("UPDATE briefs SET last_collect_at = datetime('now'), collect_run = ? WHERE id = ? AND collect_run IS NOT ?")
    .bind(run, briefId, run)
    .run();
}

/** Writes the seller's text read on the listing page into the hunt's listings; a new text voids the analysis. */
export async function applyDetails(db: D1Database, briefId: string, details: { id: string; body: string; sellerId: string | null }[]): Promise<number> {
  if (!details.length) return 0;
  const statement = db.prepare(
    `UPDATE ads SET
       analysis = CASE WHEN json_extract(data, '$.body') IS NOT ? THEN NULL ELSE analysis END,
       analysis_attempts = CASE WHEN json_extract(data, '$.body') IS NOT ? THEN 0 ELSE analysis_attempts END,
       verification = CASE WHEN json_extract(data, '$.body') IS NOT ? THEN NULL ELSE verification END,
       data = json_set(data, '$.body', ?, '$.sellerId', COALESCE(?, json_extract(data, '$.sellerId')))
     WHERE brief_id = ? AND id = ?`,
  );
  const stmts = details.map((d) => statement.bind(d.body, d.body, d.body, d.body, d.sellerId, briefId, d.id));
  let changed = 0;
  for (let i = 0; i < stmts.length; i += 50) {
    const results = await db.batch(stmts.slice(i, i + 50));
    changed += results.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
  }
  return changed;
}

/** Price curves of these model keys fitted less than `maxAgeDays` ago. */
export async function curvesFor(db: D1Database, keys: string[], maxAgeDays: number): Promise<Record<string, import('../contracts/types').PriceCurve>> {
  const out: Record<string, import('../contracts/types').PriceCurve> = {};
  const unique = [...new Set(keys)];
  const since = new Date(Date.now() - maxAgeDays * 86_400_000).toISOString();
  for (let i = 0; i < unique.length; i += 90) {
    const chunk = unique.slice(i, i + 90);
    if (!chunk.length) continue;
    const { results } = await db
      .prepare(`SELECT key, curve FROM model_curves WHERE fitted_at > ? AND key IN (${chunk.map(() => '?').join(',')})`)
      .bind(since, ...chunk)
      .all<{ key: string; curve: string }>();
    for (const r of results) out[r.key] = JSON.parse(r.curve);
  }
  return out;
}

export async function saveCurve(db: D1Database, key: string, curve: import('../contracts/types').PriceCurve): Promise<void> {
  await db
    .prepare('INSERT OR REPLACE INTO model_curves (key, curve, fitted_at) VALUES (?, ?, ?)')
    .bind(key, JSON.stringify(curve), curve.fittedAt ?? new Date().toISOString())
    .run();
}

export async function searchReadAt(db: D1Database, url: string): Promise<string | null> {
  const row = await db.prepare('SELECT read_at FROM search_reads WHERE url = ?').bind(url).first<{ read_at: string }>();
  return row?.read_at ?? null;
}

export async function markSearchRead(db: D1Database, url: string, at: string): Promise<void> {
  await db.prepare('INSERT OR REPLACE INTO search_reads (url, read_at) VALUES (?, ?)').bind(url, at).run();
}

/** Rewrites the latest plan of a hunt in place (added data only: no new version). */
export async function updateLatestPlan(db: D1Database, briefId: string, plan: Plan): Promise<void> {
  await db
    .prepare('UPDATE plans SET plan = ? WHERE id = (SELECT id FROM plans WHERE brief_id = ? ORDER BY created_at DESC LIMIT 1)')
    .bind(JSON.stringify(plan), briefId)
    .run();
}
