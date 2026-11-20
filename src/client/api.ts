import type { Ad, Brief, Plan, Refine, StoredAd } from '../shared/types';

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
  addAds: (id: string, searchLabel: string | null, ads: Ad[]) =>
    call<{ added: number; updated: number; excluded: number }>('POST', `/briefs/${id}/ads`, { searchLabel, ads }),
  analyse: (id: string) => call<{ analysed: number; remaining: number }>('POST', `/briefs/${id}/analyse`),
  refine: (id: string) => call<Refine>('POST', `/briefs/${id}/refine`),
  flagAd: (id: string, adId: string, flags: { favorite?: boolean; hidden?: boolean }) =>
    call<{ ok: true }>('PATCH', `/briefs/${id}/ads/${adId}`, flags),
};
