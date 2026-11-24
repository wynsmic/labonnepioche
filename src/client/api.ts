import type { SellerCheck } from '../shared/seller';
import type { PriceCurve } from '../shared/pricing';
import type { Ad, Brief, Plan, Search, StoredAd, Verification } from '../shared/types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(data.error ?? `Erreur ${res.status}`, res.status);
  return data as T;
}

export interface BriefDetail {
  brief: Brief;
  versions: { id: string; prompt: string; note: string | null; createdAt: string }[];
  plan: { plan: Plan; createdAt: string } | null;
  ads: StoredAd[];
  pending: number;
  /** Price curves of the models of these listings, fitted on national listings (key: make|model|fuel). */
  curves: Record<string, PriceCurve>;
}

/** The price analysis needs a national search the bank lacks: the page reads these pages and calls again. */
export interface NeedCandidates {
  needCandidates: true;
  urls: string[];
  pauseMs: [number, number];
}

export const api = {
  me: () => call<{ ok: true; mock: boolean; provider: string; model: string }>('GET', '/me'),
  login: (password: string) => call<{ ok: true }>('POST', '/login', { password }),
  logout: () => call<{ ok: true }>('POST', '/logout'),
  briefs: () => call<Brief[]>('GET', '/briefs'),
  createBrief: (input: { title: string; prompt: string; zone?: string }) =>
    call<Brief>('POST', '/briefs', input),
  brief: (id: string) => call<BriefDetail>('GET', `/briefs/${id}`),
  updateBrief: (id: string, patch: { title?: string; prompt?: string; note?: string; zone?: string }) =>
    call<Brief>('PATCH', `/briefs/${id}`, patch),
  deleteBrief: (id: string) => call<{ ok: true }>('DELETE', `/briefs/${id}`),
  plan: (id: string) => call<{ plan: Plan; createdAt: string }>('POST', `/briefs/${id}/plan`),
  /** `run` identifies one collection: its first call marks the start of "new" listings. */
  addAds: (id: string, searchLabel: string | null, ads: Ad[], run?: string) =>
    call<{ added: number; updated: number; restored: number; seenAt: string; offTarget: number; excluded: number }>('POST', `/briefs/${id}/ads`, {
      searchLabel,
      ads,
      run,
    }),
  analyse: (id: string) => call<{ analysed: number; remaining: number }>('POST', `/briefs/${id}/analyse`),
  prune: (id: string, since: string, labels: string[]) =>
    call<{ removed: number }>('POST', `/briefs/${id}/prune`, { since, labels }),
  /** One call when the national search is in the bank (15 days); otherwise { needCandidates, urls } to read. */
  verify: (id: string, adId: string, query: Search, candidates?: Ad[]) =>
    call<Verification | NeedCandidates>('POST', `/briefs/${id}/ads/${adId}/verify`, { query, candidates }),
  /** Listings whose page (seller's text) must be read by the extension. */
  detailsNeeded: (id: string) => call<{ ads: { id: string; url: string }[] }>('GET', `/briefs/${id}/details-needed`),
  saveDetails: (id: string, details: { id: string; body: string; sellerId: string | null; sellerName: string | null }[]) =>
    call<{ saved: number; changed: number }>('POST', `/briefs/${id}/details`, { details }),
  sellerCheck: (
    id: string,
    adId: string,
    profile: { sellerId: string; memberSince: string | null; totalAds: number | null; badges: string[]; ads: unknown[] },
  ) =>
    call<SellerCheck>('POST', `/briefs/${id}/ads/${adId}/seller`, {
      sellerId: profile.sellerId,
      memberSince: profile.memberSince,
      totalAds: profile.totalAds,
      badges: profile.badges,
      ads: profile.ads,
    }),
  /** A seller checked in the last 15 days, from any hunt (null when Leboncoin must be read). */
  cachedSeller: (id: string, adId: string, sellerId?: string) =>
    call<SellerCheck>('POST', `/briefs/${id}/ads/${adId}/seller/cached`, { sellerId }).catch((e) => {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }),
  /** A follow-up question about one listing; previous questions and answers give the context. */
  ask: (id: string, adId: string, question: string, history: { q: string; a: string }[]) =>
    call<{ answer: string }>('POST', `/briefs/${id}/ads/${adId}/ask`, { question, history }),
  /** Adds a model by name to the hunt: its shortlist entry and search (index of the new search). */
  addModel: (id: string, name: string) => call<{ pick: { name: string }; search: Search; index: number }>('POST', `/briefs/${id}/models`, { name }),
  /** Removes a model from the hunt (shortlist entry + its searches); returns the removed search indexes. */
  removeModel: (id: string, name: string) => call<{ removed: number[] }>('DELETE', `/briefs/${id}/models`, { name }),
  flagAd: (id: string, adId: string, flags: { favorite?: boolean; hidden?: boolean; contacted?: boolean }) =>
    call<{ ok: true }>('PATCH', `/briefs/${id}/ads/${adId}`, flags),
};
