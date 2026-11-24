import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { buildSearchUrl, isExcluded, locationsFromUrl, matchesSearch } from '../shared/leboncoin';
import { parseZone, toLocationsParam } from '../shared/zone';
import { resolvePlaces } from './geo';
import { comparables, compare } from '../shared/compare';
import { SellerProfileSchema, assessSeller, profileUrl } from '../shared/seller';
import { SearchSchema, type Ad, type Plan, type StoredAd } from '../shared/types';
import { ageFrom, fitMarket, kmFrom, type PriceCurve } from '../shared/pricing';
import { SESSION_COOKIE, checkPassword, createSession, requireSession } from './auth';
import { addModel, analyseAds, askAboutAd, extractFacts, preparePlan, pricePoints, verifyAd } from './ai';
import { AiError, llm, modelLabel } from './llm';
import * as db from './db';
import { cachedSeller, promptKey, remember, rememberSeller, restore } from './cache';
import { bankAds, bankCandidates, bankDetails, bankModel, factsOf, knownTexts, saveFacts, withoutDetail, withoutFacts } from './bank';
import { AD_CACHE_DAYS } from './cache';
import { curveKey, estimateAll, estimateOf, priceInputs, aiCurveOf } from '../shared/estimate';
import { comparableQuery } from '../shared/compare';
import type { SellerCheck } from '../shared/seller';
import type { AppEnv } from './env';

const ANALYSE_BATCH = 12;

const app = new Hono<AppEnv>().basePath('/api');

app.get('/health', (c) => c.json({ ok: true }));

app.post('/login', async (c) => {
  const { password } = z.object({ password: z.string() }).parse(await c.req.json());
  if (!(await checkPassword(c.env, password))) return c.json({ error: 'Mot de passe incorrect' }, 401);
  const session = await createSession(c.env);
  setCookie(c, SESSION_COOKIE, session.value, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    maxAge: session.maxAge,
  });
  return c.json({ ok: true });
});

app.use('/*', requireSession);

app.post('/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

app.get('/me', (c) =>
  c.json({ ok: true, mock: c.env.MOCK_AI === '1', provider: llm(c.env).label, model: modelLabel(c.env) }),
);

// --- Hunts ---

app.get('/briefs', async (c) => c.json(await db.listBriefs(c.env.DB)));

const BriefInput = z.object({
  title: z.string().min(1).max(120),
  prompt: z.string().min(3).max(8000),
  /** "Rennes 30 km, Saint-Malo" (or a Leboncoin search URL); empty = all of France. */
  zone: z.string().max(4000).optional(),
});

/** Turns the typed places into Leboncoin's `locations` parameter. */
async function resolveZone(text: string): Promise<{ text: string | null; locations: string | null } | { error: string }> {
  const trimmed = text.trim();
  if (!trimmed) return { text: null, locations: null };
  if (/^https?:\/\//.test(trimmed)) {
    const locations = locationsFromUrl(trimmed);
    return locations ? { text: trimmed, locations } : { error: 'Cette adresse Leboncoin ne contient pas de zone.' };
  }
  const places = parseZone(trimmed);
  if (!places.length) return { error: 'Indique au moins une ville.' };
  const { resolved, missing } = await resolvePlaces(places);
  if (missing.length) {
    return { error: `Ville introuvable : ${missing.join(', ')}. Indique des noms de communes (ex. « Rennes 30 km »).` };
  }
  return { text: trimmed, locations: toLocationsParam(resolved) };
}

app.post('/briefs', async (c) => {
  const input = BriefInput.parse(await c.req.json());
  const zone = await resolveZone(input.zone ?? '');
  if ('error' in zone) return c.json({ error: zone.error }, 400);
  const brief = await db.createBrief(c.env.DB, {
    title: input.title,
    prompt: input.prompt,
    zone: zone.text,
    locations: zone.locations,
  });
  return c.json(brief, 201);
});

app.get('/briefs/:id', async (c) => {
  const brief = await db.getBrief(c.env.DB, c.req.param('id'));
  if (!brief) return c.json({ error: 'Recherche introuvable' }, 404);
  const [versions, plan, ads, pending] = await Promise.all([
    db.listVersions(c.env.DB, brief.id),
    db.latestPlan(c.env.DB, brief.id),
    db.listAds(c.env.DB, brief.id),
    db.countToAnalyse(c.env.DB, brief.id),
  ]);
  const curves = await modelCurves(c.env.DB, ads, plan?.plan ?? null);
  return c.json({ brief, versions, plan, ads, pending, curves });
});

app.patch('/briefs/:id', async (c) => {
  const brief = await db.getBrief(c.env.DB, c.req.param('id'));
  if (!brief) return c.json({ error: 'Recherche introuvable' }, 404);
  const patch = BriefInput.partial()
    .extend({ note: z.string().max(500).optional(), includePros: z.boolean().optional() })
    .parse(await c.req.json());
  const zone = patch.zone === undefined ? undefined : await resolveZone(patch.zone);
  if (zone && 'error' in zone) return c.json({ error: zone.error }, 400);
  const updated = await db.updateBrief(c.env.DB, brief, {
    title: patch.title,
    prompt: patch.prompt,
    note: patch.note,
    zone,
    includePros: patch.includePros,
  });
  return c.json(updated);
});

app.delete('/briefs/:id', async (c) => {
  await db.deleteBrief(c.env.DB, c.req.param('id'));
  return c.json({ ok: true });
});

// --- Claude steps ---

app.post('/briefs/:id/plan', async (c) => {
  const brief = await db.getBrief(c.env.DB, c.req.param('id'));
  if (!brief) return c.json({ error: 'Recherche introuvable' }, 404);
  let plan = await preparePlan(c.env, brief.prompt);
  // Price points of each model, in a second light call; the plan stays usable without them.
  try {
    plan = await pricePoints(c.env, plan);
  } catch (err) {
    console.error('price points', err);
  }
  await db.savePlan(c.env.DB, brief.id, brief.prompt, plan);
  // A new plan makes the verdicts stale, unless the demand is the same: the cache (15 days) gives back
  // the analyses made for this very demand.
  await db.resetAnalyses(c.env.DB, brief.id);
  await restore(c.env.DB, brief.id, brief.prompt);
  return c.json(await db.latestPlan(c.env.DB, brief.id));
});

/**
 * Price curve of every model of these listings: the national fit when « Analyser le prix » ran in
 * the last 15 days; otherwise, when the bank holds enough listings of the model (collections of
 * any hunt), the level measured on them with the AI's curve shape (the AI's level runs high);
 * otherwise nothing here (the client falls back to the AI curve alone).
 */
async function modelCurves(database: D1Database, ads: StoredAd[], plan: Plan | null): Promise<Record<string, PriceCurve>> {
  const keys = new Map<string, StoredAd>();
  for (const ad of ads) {
    const key = curveKey(ad);
    if (key && !keys.has(key)) keys.set(key, ad);
  }
  const curves = await db.curvesFor(database, [...keys.keys()], AD_CACHE_DAYS);
  for (const [key, sample] of keys) {
    if (curves[key]) continue;
    const brand = sample.attributes.brand ?? sample.attributes.u_car_brand;
    const model = sample.attributes.model ?? sample.attributes.u_car_model;
    if (!brand || !model) continue;
    const same = (await bankModel(database, brand, model)).filter((a) => curveKey(a) === key && a.price != null && a.seller !== 'pro');
    const points = same
      .map((a) => ({ age: ageFrom(a.attributes), km: kmFrom(a.attributes), price: a.price! }))
      .filter((p): p is { age: number; km: number | null; price: number } => p.age != null);
    // A local sample (one area, filtered by the hunt's price and mileage caps) is trusted with the level only.
    const fit = fitMarket(points, aiCurveOf(plan, sample), new Date(), { allowSlopes: false });
    if (fit) curves[key] = { ...fit.curve, source: 'local' };
  }
  return curves;
}

/** Adds a model the user names to the hunt (shortlist choice + its search); verdicts already made stay. */
app.post('/briefs/:id/models', async (c) => {
  const brief = await db.getBrief(c.env.DB, c.req.param('id'));
  if (!brief) return c.json({ error: 'Recherche introuvable' }, 404);
  const { name } = z.object({ name: z.string().trim().min(2).max(120) }).parse(await c.req.json());
  const current = await db.latestPlan(c.env.DB, brief.id);
  if (!current) return c.json({ error: 'Prépare d’abord la recherche' }, 409);
  const fold = (t: string) => t.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, ' ').trim();
  if (current.plan.shortlist.some((p) => fold(p.name) === fold(name))) return c.json({ error: 'Ce modèle est déjà dans la recherche' }, 409);
  const plan = await addModel(c.env, brief.prompt, current.plan, name);
  await db.updateLatestPlan(c.env.DB, brief.id, plan);
  const added = plan.searches[plan.searches.length - 1];
  return c.json({ pick: plan.shortlist[plan.shortlist.length - 1], search: added, index: plan.searches.length - 1 });
});

/** Removes a model from the hunt: its shortlist entry and the searches that target it (listings already found stay). */
app.delete('/briefs/:id/models', async (c) => {
  const brief = await db.getBrief(c.env.DB, c.req.param('id'));
  if (!brief) return c.json({ error: 'Recherche introuvable' }, 404);
  const { name } = z.object({ name: z.string().trim().min(1).max(200) }).parse(await c.req.json());
  const current = await db.latestPlan(c.env.DB, brief.id);
  if (!current) return c.json({ error: 'Pas encore de plan' }, 409);
  const fold = (t: string) => t.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, ' ').trim();
  const target = fold(name);
  if (!current.plan.shortlist.some((p) => fold(p.name) === target)) return c.json({ error: 'Modèle introuvable dans la recherche' }, 404);
  if (current.plan.shortlist.length <= 1) return c.json({ error: 'Il faut garder au moins un modèle' }, 409);
  const removed = current.plan.searches.flatMap((s, i) => (fold(s.pick ?? '') === target ? [i] : []));
  const plan = {
    ...current.plan,
    shortlist: current.plan.shortlist.filter((p) => fold(p.name) !== target),
    searches: current.plan.searches.filter((_, i) => !removed.includes(i)),
  };
  await db.updateLatestPlan(c.env.DB, brief.id, plan);
  return c.json({ removed });
});

/** Adds the models' market price points to the current plan (plans made before they existed). */
app.post('/briefs/:id/price-points', async (c) => {
  const brief = await db.getBrief(c.env.DB, c.req.param('id'));
  if (!brief) return c.json({ error: 'Recherche introuvable' }, 404);
  const current = await db.latestPlan(c.env.DB, brief.id);
  if (!current) return c.json({ error: 'Pas encore de plan' }, 409);
  const plan = await pricePoints(c.env, current.plan);
  await db.updateLatestPlan(c.env.DB, brief.id, plan);
  return c.json({ shortlist: plan.shortlist.map((p) => ({ name: p.name, years: p.years, price_points: (p as { price_points?: unknown }).price_points })) });
});

const AdSchema = z.object({
  id: z.string().min(1).max(40),
  url: z.string().url().max(500),
  title: z.string().max(300),
  body: z.string().max(20000),
  price: z.number().nullable(),
  date: z.string().nullable(),
  city: z.string().nullable(),
  zipcode: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  image: z.string().max(1000).nullable(),
  seller: z.enum(['pro', 'private']).nullable(),
  sellerId: z.string().max(80).nullable().optional(),
  sellerName: z.string().max(200).nullable().optional(),
  attributes: z.record(z.string(), z.string()),
});

app.post('/briefs/:id/ads', async (c) => {
  const brief = await db.getBrief(c.env.DB, c.req.param('id'));
  if (!brief) return c.json({ error: 'Recherche introuvable' }, 404);
  const input = z
    .object({ searchLabel: z.string().max(200).nullable(), ads: z.array(AdSchema).max(200), run: z.string().max(64).optional() })
    .parse(await c.req.json());
  if (input.run) await db.markCollectRun(c.env.DB, brief.id, input.run);
  // Keep only listings that match the planned search and contain no disqualifying keyword.
  const current = await db.latestPlan(c.env.DB, brief.id);
  const search = current?.plan.searches.find((s) => s.label === input.searchLabel);
  const onTarget = search ? input.ads.filter((ad: Ad) => matchesSearch(ad, search, { pros: brief.includePros })) : input.ads;
  const kept = onTarget.filter((ad: Ad) => !isExcluded(`${ad.title} ${ad.body}`, search?.exclude_keywords ?? []));
  const seenAt = new Date().toISOString();
  // Search results carry no description: keep the text already read on the listing page.
  const texts = await knownTexts(c.env.DB, kept.map((a: Ad) => a.id));
  for (const ad of kept as Ad[]) {
    const t = texts.get(ad.id);
    if (t && !ad.body) {
      ad.body = t.body;
      ad.sellerId ??= t.sellerId;
    }
  }
  const counts = await db.upsertAds(c.env.DB, brief.id, input.searchLabel, kept, seenAt);
  // Everything read goes to the shared bank, even off-target listings: they are comparables for others.
  await bankAds(c.env.DB, input.ads, seenAt);
  // Listings already judged in the last 15 days get their analysis, check and seller back for free.
  const restored = await restore(c.env.DB, brief.id, brief.prompt);
  return c.json({ ...counts, restored, seenAt, offTarget: input.ads.length - onTarget.length, excluded: onTarget.length - kept.length });
});

/** Listings of the hunt whose page must be read (text unknown or older than 15 days), for the extension. */
app.get('/briefs/:id/details-needed', async (c) => {
  const brief = await db.getBrief(c.env.DB, c.req.param('id'));
  if (!brief) return c.json({ error: 'Recherche introuvable' }, 404);
  const ads = (await db.listAds(c.env.DB, brief.id)).filter((a) => !a.hidden && a.analysis?.verdict !== 'hors_sujet');
  const missing = await withoutDetail(c.env.DB, ads.map((a) => a.id));
  return c.json({ ads: ads.filter((a) => missing.has(a.id)).map((a) => ({ id: a.id, url: a.url })) });
});

const DetailSchema = z.object({
  id: z.string().min(1).max(40),
  body: z.string().max(20000),
  sellerId: z.string().max(80).nullable(),
  sellerName: z.string().max(200).nullable(),
});

/** Listing pages read by the extension: text and seller into the bank and the hunt (a new text voids the analysis). */
app.post('/briefs/:id/details', async (c) => {
  const brief = await db.getBrief(c.env.DB, c.req.param('id'));
  if (!brief) return c.json({ error: 'Recherche introuvable' }, 404);
  const { details } = z.object({ details: z.array(DetailSchema).max(100) }).parse(await c.req.json());
  await bankDetails(c.env.DB, details, new Date().toISOString());
  const changed = await db.applyDetails(c.env.DB, brief.id, details);
  return c.json({ saved: details.length, changed });
});

/** Analyses the next batch of listings; the page calls it until `remaining` is 0. */
app.post('/briefs/:id/analyse', async (c) => {
  const brief = await db.getBrief(c.env.DB, c.req.param('id'));
  if (!brief) return c.json({ error: 'Recherche introuvable' }, 404);
  const batch = await db.adsToAnalyse(c.env.DB, brief.id, ANALYSE_BATCH);
  let analysed = 0;
  if (batch.length) {
    const current = await db.latestPlan(c.env.DB, brief.id);
    const ids = batch.map((a) => a.id);
    // What the sellers' texts say, read once per listing by a small model (shared bank).
    const noFacts = await withoutFacts(c.env.DB, ids);
    if (noFacts.size) {
      const facts = await extractFacts(c.env, batch.filter((a) => noFacts.has(a.id) && a.body.trim()));
      await saveFacts(c.env.DB, facts, new Date().toISOString());
    }
    // Expected price: curve of the model (national fit, else the plan's AI price points) × the facts.
    const all = await db.listAds(c.env.DB, brief.id);
    const curves = await modelCurves(c.env.DB, all, current?.plan ?? null);
    const estimates = estimateAll(all, current?.plan ?? null, curves);
    try {
      const analyses = await analyseAds(c.env, brief.prompt, current?.plan ?? null, batch, estimates);
      await db.saveAnalyses(c.env.DB, brief.id, ids, analyses);
      const at = new Date().toISOString();
      const byId = new Map(batch.map((a) => [a.id, a]));
      await remember(
        c.env.DB,
        brief.id,
        analyses.flatMap((a) => {
          const ad = byId.get(a.id);
          return ad ? [{ ad, fields: { prompt_key: promptKey(brief.prompt), analysis: JSON.stringify(a), analysed_at: at } }] : [];
        }),
      );
      analysed = analyses.length;
    } catch (err) {
      // Count the attempt so a batch that always fails leaves the queue after 3 tries.
      await db.saveAnalyses(c.env.DB, brief.id, ids, []);
      throw err;
    }
  }
  return c.json({ analysed, remaining: await db.countToAnalyse(c.env.DB, brief.id) });
});

/** Removes collected listings that don't match their search (favourites are kept). */
/**
 * End of a complete collection: the list becomes what Leboncoin shows now. Listings not read
 * again since `since` (sold, off the new plan, filtered out) go; favourites stay. Listings read
 * again unchanged keep their analysis.
 */
app.post('/briefs/:id/prune', async (c) => {
  const { since, labels } = z
    .object({ since: z.string().datetime(), labels: z.array(z.string().max(200)).max(50) })
    .parse(await c.req.json());
  const briefId = c.req.param('id');
  // Searches left unchecked keep their listings; listings of searches no longer in the plan go.
  const current = await db.latestPlan(c.env.DB, briefId);
  const keep = (current?.plan.searches.map((s) => s.label) ?? []).filter((l) => !labels.includes(l));
  return c.json({ removed: await db.pruneUnseen(c.env.DB, briefId, since, keep) });
});

/** Pages of a national search read for a price analysis (up to ~100 listings) and the pause between them. */
const NATIONAL_PAGES = 3;
const PAGE_PAUSE_MS: [number, number] = [4_000, 7_000];

/**
 * Price analysis of one listing, in one call when the bank already holds the national search:
 * 1. the national search of its model (±4 years, any mileage) must have been read in the last 15
 *    days; otherwise the route answers { needCandidates, urls } (Leboncoin is read only in the
 *    user's browser): the page reads exactly those pages and calls again with what it read;
 * 2. the price curve of the model is fitted on every listing of the bank that fits that search
 *    (wrecks and doubtful mileages left out), starting from the plan's AI curve, and saved: every
 *    listing of that model in every hunt now uses it;
 * 3. this listing's expected price = curve at its age and mileage × what its text says;
 * 4. the model gives its verdict with that context.
 */
app.post('/briefs/:id/ads/:adId/verify', async (c) => {
  const brief = await db.getBrief(c.env.DB, c.req.param('id'));
  if (!brief) return c.json({ error: 'Recherche introuvable' }, 404);
  const ad = await db.getAd(c.env.DB, brief.id, c.req.param('adId'));
  if (!ad) return c.json({ error: 'Annonce introuvable' }, 404);
  const input = z
    // Queries saved with older comparisons lack the newer fields: defaults, not a refusal.
    .object({
      query: SearchSchema.extend({ pick: z.string().default(''), required_groups: z.array(z.array(z.string())).default([]) }).optional(),
      candidates: z.array(AdSchema).max(400).optional(),
    })
    .parse(await c.req.json());
  const current = await db.latestPlan(c.env.DB, brief.id);
  const category = current?.plan.searches.find((s) => s.label === (ad as Ad & { searchLabel?: string }).searchLabel)?.category ?? 2;
  const query = input.query ?? comparableQuery(ad, category);
  const at = new Date().toISOString();
  const url = buildSearchUrl(query, null);
  let searchedAt = at;
  if (input.candidates) {
    await bankAds(c.env.DB, input.candidates, at);
    await db.markSearchRead(c.env.DB, url, at);
  } else {
    const readAt = await db.searchReadAt(c.env.DB, url);
    if (!readAt || Date.parse(readAt) < Date.now() - AD_CACHE_DAYS * 86_400_000) {
      return c.json({
        needCandidates: true as const,
        urls: Array.from({ length: NATIONAL_PAGES }, (_, i) => buildSearchUrl(query, null, i + 1)),
        pauseMs: PAGE_PAUSE_MS,
      });
    }
    searchedAt = readAt;
  }

  const bank = await bankCandidates(c.env.DB, ad, query);
  // Listings without make/model in their attributes are only found in what the page just read.
  const pool = [...new Map([...bank.ads, ...(input.candidates ?? [])].map((a) => [a.id, a])).values()];
  // Wrecks and doubtful mileages (read in their text) would bend the curve.
  const facts = await factsOf(c.env.DB, pool.map((a) => a.id));
  const clean = pool.filter((a) => {
    const f = facts.get(a.id);
    return !f || (f.accident !== 'lourd' && !f.mileage_doubt);
  });
  const exclude = [...new Set(current?.plan.searches.flatMap((s) => s.exclude_keywords) ?? [])];
  const prior = aiCurveOf(current?.plan ?? null, ad);
  const result = compare(ad, clean, query, exclude, at, prior);
  const key = curveKey(ad);
  // Saved first: the price comparison stays useful even if the model call fails.
  if (result) {
    await db.saveComparison(c.env.DB, brief.id, ad.id, result.comparison);
    if (key) await db.saveCurve(c.env.DB, key, result.curve);
  }
  const stored = (await db.listAds(c.env.DB, brief.id)).find((a) => a.id === ad.id);
  const inputs = stored ? priceInputs(stored, current?.plan ?? null, result && key ? { [key]: result.curve } : {}) : null;
  const estimate = stored && inputs ? estimateOf(stored, inputs) : null;
  const { kept } = comparables(ad, clean, exclude);
  const verdict = await verifyAd(
    c.env,
    brief.prompt,
    current?.plan ?? null,
    stored ?? ad,
    result?.comparison ?? null,
    result ? kept : [],
    stored?.sellerCheck ?? null,
    estimate,
  );
  const comparison = result?.comparison ?? null;
  const verification = { ...verdict, at, searchedAt, comparables: comparison?.count ?? 0, match: comparison?.match ?? null };
  await db.saveVerification(c.env.DB, brief.id, ad.id, comparison, verification);
  await remember(c.env.DB, brief.id, [
    {
      ad,
      fields: {
        prompt_key: promptKey(brief.prompt),
        verification: JSON.stringify(verification),
        comparison: comparison ? JSON.stringify(comparison) : null,
        verified_at: at,
      },
    },
  ]);
  return c.json(verification);
});

/** A follow-up question about one listing (detail panel of the verdict): a few words back. */
app.post('/briefs/:id/ads/:adId/ask', async (c) => {
  const brief = await db.getBrief(c.env.DB, c.req.param('id'));
  if (!brief) return c.json({ error: 'Recherche introuvable' }, 404);
  const input = z
    .object({
      question: z.string().trim().min(2).max(500),
      history: z.array(z.object({ q: z.string().max(500), a: z.string().max(2000) })).max(6).default([]),
    })
    .parse(await c.req.json());
  const all = await db.listAds(c.env.DB, brief.id);
  const ad = all.find((a) => a.id === c.req.param('adId'));
  if (!ad) return c.json({ error: 'Annonce introuvable' }, 404);
  const current = await db.latestPlan(c.env.DB, brief.id);
  const curves = await modelCurves(c.env.DB, [ad], current?.plan ?? null);
  const estimate = estimateOf(ad, priceInputs(ad, current?.plan ?? null, curves));
  const answer = await askAboutAd(
    c.env,
    brief.prompt,
    ad,
    { analysis: ad.analysis, verification: ad.verification, facts: ad.facts, estimate, comparison: ad.comparison },
    input.history,
    input.question,
  );
  return c.json({ answer });
});

/** Seller profile read by the extension for a striking deal: judged with average rules, stored. */
app.post('/briefs/:id/ads/:adId/seller', async (c) => {
  const briefId = c.req.param('id');
  const ad = await db.getAd(c.env.DB, briefId, c.req.param('adId'));
  if (!ad) return c.json({ error: 'Annonce introuvable' }, 404);
  const body = SellerProfileSchema.extend({ sellerId: z.string().regex(/^[\w-]{6,80}$/) }).parse(await c.req.json());
  // Listings read before the seller's id was collected learn it now.
  if (!ad.sellerId) await db.setSellerId(c.env.DB, briefId, ad.id, body.sellerId);
  const sellerId = ad.sellerId ?? body.sellerId;
  const check = assessSeller(body, profileUrl(sellerId), ad.title);
  await db.saveSellerCheck(c.env.DB, briefId, ad.id, check);
  await rememberSeller(c.env.DB, sellerId, check);
  await remember(c.env.DB, briefId, [{ ad, fields: { seller_id: sellerId } }]);
  return c.json(check);
});

/** A seller checked in the last 15 days (any hunt): reused without reading Leboncoin again. */
app.post('/briefs/:id/ads/:adId/seller/cached', async (c) => {
  const briefId = c.req.param('id');
  const ad = await db.getAd(c.env.DB, briefId, c.req.param('adId'));
  if (!ad) return c.json({ error: 'Annonce introuvable' }, 404);
  const { sellerId: given } = z.object({ sellerId: z.string().regex(/^[\w-]{6,80}$/).optional() }).parse(await c.req.json());
  const sellerId = ad.sellerId ?? given;
  if (!sellerId) return c.json({ error: 'Vendeur inconnu' }, 404);
  if (!ad.sellerId) await db.setSellerId(c.env.DB, briefId, ad.id, sellerId);
  const check = await cachedSeller<SellerCheck>(c.env.DB, sellerId);
  if (!check) return c.json({ error: 'Pas en cache' }, 404);
  await db.saveSellerCheck(c.env.DB, briefId, ad.id, check);
  return c.json(check);
});

app.patch('/briefs/:id/ads/:adId', async (c) => {
  const flags = z.object({ favorite: z.boolean().optional(), hidden: z.boolean().optional(), contacted: z.boolean().optional() }).parse(await c.req.json());
  await db.setAdFlags(c.env.DB, c.req.param('id'), c.req.param('adId'), flags);
  return c.json({ ok: true });
});

app.onError((err, c) => {
  if (err instanceof z.ZodError) return c.json({ error: 'Requête invalide', details: err.issues }, 400);
  if (err instanceof AiError) return c.json({ error: err.message }, 502);
  if (err instanceof OpenAI.RateLimitError && (err.type === 'insufficient_quota' || err.code === 'insufficient_quota' || err.code === 'credit_balance_exhausted')) {
    return c.json({ error: 'Plus de crédit OpenAI : recharge sur platform.openai.com/settings/organization/billing' }, 402);
  }
  if (err instanceof Anthropic.RateLimitError || err instanceof OpenAI.RateLimitError) {
    return c.json({ error: 'Le modèle est surchargé ou ton quota est atteint, réessaie dans une minute' }, 503);
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof OpenAI.AuthenticationError) {
    return c.json({ error: 'Clé API invalide' }, 502);
  }
  if (err instanceof Anthropic.APIError || err instanceof OpenAI.APIError) {
    return c.json({ error: `Erreur du modèle (${err.status ?? '?'}) : ${err.message.slice(0, 200)}` }, 502);
  }
  // Unreadable structured output, for instance.
  if (err instanceof Anthropic.AnthropicError || err instanceof OpenAI.OpenAIError) {
    return c.json({ error: 'Réponse du modèle illisible, réessaie' }, 502);
  }
  console.error(err);
  return c.json({ error: 'Erreur interne' }, 500);
});

export default app;
