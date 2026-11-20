import type { Comparison } from '../shared/compare';
import type { Ad, Analysis, Brief, Plan, StoredAd } from '../shared/types';

interface BriefRow {
  id: string;
  title: string;
  prompt: string;
  zone: string | null;
  locations: string | null;
  updated_at: string;
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
}

const toBrief = (r: BriefRow): Brief => ({
  id: r.id,
  title: r.title,
  prompt: r.prompt,
  zone: r.zone,
  locations: r.locations,
  updatedAt: r.updated_at,
});

const toAd = (r: AdRow): StoredAd => ({
  ...(JSON.parse(r.data) as Ad),
  searchLabel: r.search_label,
  firstSeen: r.first_seen,
  firstPrice: r.first_price,
  comparison: r.comparison ? (JSON.parse(r.comparison) as Comparison) : null,
  favorite: r.favorite === 1,
  hidden: r.hidden === 1,
  analysis: r.analysis ? (JSON.parse(r.analysis) as Analysis) : null,
});

export async function listBriefs(db: D1Database): Promise<Brief[]> {
  const { results } = await db
    .prepare('SELECT id, title, prompt, zone, locations, updated_at FROM briefs ORDER BY updated_at DESC')
    .all<BriefRow>();
  return results.map(toBrief);
}

export async function getBrief(db: D1Database, id: string): Promise<Brief | null> {
  const row = await db
    .prepare('SELECT id, title, prompt, zone, locations, updated_at FROM briefs WHERE id = ?')
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
  patch: { title?: string; prompt?: string; zone?: { text: string | null; locations: string | null }; note?: string },
): Promise<Brief> {
  const next = {
    title: patch.title ?? brief.title,
    prompt: patch.prompt ?? brief.prompt,
    zone: patch.zone ? patch.zone.text : brief.zone,
    locations: patch.zone ? patch.zone.locations : brief.locations,
  };
  const statements = [
    db
      .prepare(
        "UPDATE briefs SET title = ?, prompt = ?, zone = ?, locations = ?, updated_at = datetime('now') WHERE id = ?",
      )
      .bind(next.title, next.prompt, next.zone, next.locations, brief.id),
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
      'SELECT id, data, search_label, first_seen, analysis, favorite, hidden, first_price, comparison FROM ads WHERE brief_id = ? ORDER BY first_seen DESC',
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
    `INSERT INTO ads (brief_id, id, data, search_label, first_price) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (brief_id, id) DO UPDATE SET
       analysis = CASE
         WHEN json_extract(ads.data, '$.price') IS NOT json_extract(excluded.data, '$.price')
           OR json_extract(ads.data, '$.body') IS NOT json_extract(excluded.data, '$.body')
         THEN NULL ELSE ads.analysis END,
       analysis_attempts = CASE
         WHEN json_extract(ads.data, '$.price') IS NOT json_extract(excluded.data, '$.price')
           OR json_extract(ads.data, '$.body') IS NOT json_extract(excluded.data, '$.body')
         THEN 0 ELSE ads.analysis_attempts END,
       data = excluded.data`,
  );
  for (let i = 0; i < ads.length; i += 50) {
    await db.batch(
      ads.slice(i, i + 50).map((ad) => upsert.bind(briefId, ad.id, JSON.stringify(ad), searchLabel, ad.price)),
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
  flags: { favorite?: boolean; hidden?: boolean },
): Promise<void> {
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
export async function resetAnalyses(db: D1Database, briefId: string): Promise<void> {
  await db.prepare('UPDATE ads SET analysis = NULL, analysis_attempts = 0 WHERE brief_id = ?').bind(briefId).run();
}

export async function deleteAds(db: D1Database, briefId: string, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    await db
      .prepare(`DELETE FROM ads WHERE brief_id = ? AND id IN (${chunk.map(() => '?').join(',')})`)
      .bind(briefId, ...chunk)
      .run();
  }
}
