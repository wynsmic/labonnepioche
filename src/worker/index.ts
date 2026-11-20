import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { isExcluded, locationsFromUrl } from '../shared/leboncoin';
import { parseZone, toLocationsParam } from '../shared/zone';
import { resolvePlaces } from './geo';
import { MIN_COMPARABLES, compare } from '../shared/compare';
import { SearchSchema, type Ad } from '../shared/types';
import { SESSION_COOKIE, checkPassword, createSession, requireSession } from './auth';
import { analyseAds, preparePlan, refinePrompt } from './ai';
import { AiError, llm, modelLabel } from './llm';
import * as db from './db';
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
  return c.json({ brief, versions, plan, ads, pending });
});

app.patch('/briefs/:id', async (c) => {
  const brief = await db.getBrief(c.env.DB, c.req.param('id'));
  if (!brief) return c.json({ error: 'Recherche introuvable' }, 404);
  const patch = BriefInput.partial()
    .extend({ note: z.string().max(500).optional() })
    .parse(await c.req.json());
  const zone = patch.zone === undefined ? undefined : await resolveZone(patch.zone);
  if (zone && 'error' in zone) return c.json({ error: zone.error }, 400);
  const updated = await db.updateBrief(c.env.DB, brief, {
    title: patch.title,
    prompt: patch.prompt,
    note: patch.note,
    zone,
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
  const plan = await preparePlan(c.env, brief.prompt);
  await db.savePlan(c.env.DB, brief.id, brief.prompt, plan);
  return c.json(await db.latestPlan(c.env.DB, brief.id));
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
  attributes: z.record(z.string(), z.string()),
});

app.post('/briefs/:id/ads', async (c) => {
  const brief = await db.getBrief(c.env.DB, c.req.param('id'));
  if (!brief) return c.json({ error: 'Recherche introuvable' }, 404);
  const input = z
    .object({ searchLabel: z.string().max(200).nullable(), ads: z.array(AdSchema).max(200) })
    .parse(await c.req.json());
  // Drop listings that contain the search's disqualifying keywords.
  const current = await db.latestPlan(c.env.DB, brief.id);
  const exclude = current?.plan.searches.find((s) => s.label === input.searchLabel)?.exclude_keywords ?? [];
  const kept = input.ads.filter((ad: Ad) => !isExcluded(`${ad.title} ${ad.body}`, exclude));
  const counts = await db.upsertAds(c.env.DB, brief.id, input.searchLabel, kept);
  return c.json({ ...counts, excluded: input.ads.length - kept.length });
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
    try {
      const analyses = await analyseAds(c.env, brief.prompt, current?.plan ?? null, batch);
      await db.saveAnalyses(c.env.DB, brief.id, ids, analyses);
      analysed = analyses.length;
    } catch (err) {
      // Count the attempt so a batch that always fails leaves the queue after 3 tries.
      await db.saveAnalyses(c.env.DB, brief.id, ids, []);
      throw err;
    }
  }
  return c.json({ analysed, remaining: await db.countToAnalyse(c.env.DB, brief.id) });
});

app.post('/briefs/:id/refine', async (c) => {
  const brief = await db.getBrief(c.env.DB, c.req.param('id'));
  if (!brief) return c.json({ error: 'Recherche introuvable' }, 404);
  const ads = await db.listAds(c.env.DB, brief.id);
  const proposal = await refinePrompt(
    c.env,
    brief.prompt,
    ads.filter((a) => a.favorite).slice(0, 30),
    ads.filter((a) => a.hidden).slice(0, 30),
  );
  return c.json(proposal);
});

/** Places a listing among very similar ones across France (collected by the extension). */
app.post('/briefs/:id/ads/:adId/comparison', async (c) => {
  const briefId = c.req.param('id');
  const ad = await db.getAd(c.env.DB, briefId, c.req.param('adId'));
  if (!ad) return c.json({ error: 'Annonce introuvable' }, 404);
  const input = z
    .object({ query: SearchSchema, candidates: z.array(AdSchema).max(300) })
    .parse(await c.req.json());
  const current = await db.latestPlan(c.env.DB, briefId);
  const exclude = [...new Set(current?.plan.searches.flatMap((s) => s.exclude_keywords) ?? [])];
  const comparison = compare(ad, input.candidates, input.query, exclude, new Date().toISOString());
  if (!comparison) {
    return c.json({ error: `Pas assez d’annonces comparables en France (moins de ${MIN_COMPARABLES})` }, 422);
  }
  await db.saveComparison(c.env.DB, briefId, ad.id, comparison);
  return c.json(comparison);
});

app.patch('/briefs/:id/ads/:adId', async (c) => {
  const flags = z.object({ favorite: z.boolean().optional(), hidden: z.boolean().optional() }).parse(await c.req.json());
  await db.setAdFlags(c.env.DB, c.req.param('id'), c.req.param('adId'), flags);
  return c.json({ ok: true });
});

app.onError((err, c) => {
  if (err instanceof z.ZodError) return c.json({ error: 'Requête invalide', details: err.issues }, 400);
  if (err instanceof AiError) return c.json({ error: err.message }, 502);
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
