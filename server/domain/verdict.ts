import type { StoredAd, Verdict } from '../../contracts/types';

/** The listing's current verdict: the check (made with the national comparison) wins over the first analysis. */
export function verdictOf(ad: StoredAd): { verdict: Verdict; score: number; verified: boolean } | null {
  if (ad.verification) return { verdict: ad.verification.verdict, score: ad.verification.score, verified: true };
  if (ad.analysis) return { verdict: ad.analysis.verdict, score: ad.analysis.score, verified: false };
  return null;
}
