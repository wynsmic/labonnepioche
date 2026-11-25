import type { PriceCurve } from '../../contracts/types';

export type { PriceCurve };
/**
 * Market price model of one car model (one curve per model reference).
 *
 *   ln(price) = c − α·ln(1 + âge) − β·écartKm
 *   écartKm   = ln(1 + km/10 000) − ln(1 + 13 000·âge/10 000)
 *
 * - Age enters as a power law of (1 + age): the loss is steep at first and slows down, which is
 *   what French market references describe (≈ 20–25 % the first year, ≈ 15 % the second, 10–12 %
 *   the third and fourth, ≈ 7 % the fifth, ≈ 4 % a year towards ten years). α = 0.36 reproduces
 *   that table: 22 %, 14 %, 10 %, 8 %, 7 % … 3 % at ten years.
 * - Mileage enters as the log-gap to the average mileage for the age (13 000 km a year): hedonic
 *   studies of European used-car listings take mileage in logs (diminishing effect) and keep
 *   usage intensity apart from age. With β = 0.25, a 5-year-old car at 120 000 km instead of
 *   65 000 is worth ≈ 13 % less.
 * - c is the market level of the model: what a typical example is worth (exp(c) at age 0).
 *
 * Before the national analysis, the curve comes from the AI's market price points for the model
 * ("pressenti"). After it, it is fitted on the listings of that model across France: robust
 * (Huber) regression, slopes pulled towards the prior and only freed when the sample is large and
 * spread enough in age, then clamped to plausible bounds. No overfitting on a narrow sample.
 */

export const TYPICAL_KM_PER_YEAR = 13_000;

/** Generic prior (French market tables, see above) and the bounds a fitted slope may not leave. */
export const PRIOR = { alpha: 0.36, beta: 0.25, alphaSd: 0.08, betaSd: 0.08 };
export const BOUNDS = { alpha: [0.15, 0.75] as const, beta: [0.05, 0.6] as const };
/** Typical dispersion of listing prices around the curve, in log (used until data says otherwise). */
export const DEFAULT_SPREAD = 0.12;

/** Slopes are learnt from the data only with at least this many listings over this many years. */
export const MIN_FOR_SLOPES = { n: 25, years: 4, span: 3 };
/** The market level is learnt from the data with at least this many listings. */
export const MIN_FOR_LEVEL = 8;


export interface Point {
  /** Age in years (fractional). */
  age: number;
  km: number | null;
  price: number;
}

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));
const ln1p = Math.log1p;

export function kmGap(km: number | null, age: number): number {
  if (km == null || !Number.isFinite(km)) return 0;
  return ln1p(km / 10_000) - ln1p((TYPICAL_KM_PER_YEAR * Math.max(age, 0)) / 10_000);
}

export function predict(curve: PriceCurve, age: number, km: number | null): number {
  return Math.exp(curve.c - curve.alpha * ln1p(Math.max(age, 0)) - curve.beta * kmGap(km, age));
}

/** Price of a listing brought to another age and mileage along the curve. */
export function project(curve: PriceCurve, price: number, from: { age: number; km: number | null }, to: { age: number; km: number | null }): number {
  return (price * predict(curve, to.age, to.km)) / predict(curve, from.age, from.km);
}

/** Age in years from "MM/YYYY" (first registration) or the model year (taken at mid-year). */
export function ageFrom(attributes: Record<string, string>, now = Date.now()): number | null {
  const dated = attributes.issuance_date?.match(/^(\d{2})\/(\d{4})$/);
  const year = Number(attributes.regdate?.match(/\d{4}/)?.[0]);
  const start = dated ? Date.UTC(Number(dated[2]), Number(dated[1]) - 1, 15) : year > 1950 ? Date.UTC(year, 6, 1) : null;
  if (start == null) return null;
  return Math.max(0, (now - start) / (365.25 * 86_400_000));
}

export function kmFrom(attributes: Record<string, string>): number | null {
  const digits = attributes.mileage?.replace(/\D/g, '');
  return digits ? Number(digits) : null;
}

/** Mileage that cannot be true for the age ("250 km" meaning 250 000): left out of fits. */
export function implausibleKm(km: number | null, age: number): boolean {
  if (km == null) return false;
  return (age > 1.5 && km < 1_000) || km > 600_000 || km / Math.max(age, 0.5) > 80_000;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Robust standard deviation (1.4826 × median absolute deviation). */
function robustSd(residuals: number[]): number {
  if (residuals.length < 3) return DEFAULT_SPREAD;
  const m = median(residuals);
  return 1.4826 * median(residuals.map((r) => Math.abs(r - m)));
}

/** Solves a 3×3 linear system (Gaussian elimination with partial pivoting). */
function solve3(a: number[][], b: number[]): number[] | null {
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let k = col; k < 4; k++) m[r][k] -= f * m[col][k];
    }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}

/**
 * Curve from a few market price points (the AI's feel for the model, before any national data):
 * the level and the age slope from the points, pulled towards the generic prior; mileage slope
 * from the prior.
 */
export function curveFromPoints(points: Point[], prior = PRIOR): PriceCurve | null {
  const usable = points.filter((p) => p.price > 0 && p.age >= 0);
  if (!usable.length) return null;
  const beta = prior.beta;
  // Ridge on α towards the prior: minimise Σ(y − c + α·x)² + λ(α − α₀)², λ worth ~3 points.
  const lambda = 3 * DEFAULT_SPREAD ** 2 / prior.alphaSd ** 2 / usable.length;
  const xs = usable.map((p) => ln1p(p.age));
  const ys = usable.map((p) => Math.log(p.price) + beta * kmGap(p.km, p.age));
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const my = ys.reduce((s, v) => s + v, 0) / ys.length;
  const sxx = xs.reduce((s, v) => s + (v - mx) ** 2, 0);
  const sxy = xs.reduce((s, v, i) => s + (v - mx) * (ys[i] - my), 0);
  // y = c − α·x → slope = −α.
  const alpha = clamp((-sxy + lambda * usable.length * prior.alpha) / (sxx + lambda * usable.length), BOUNDS.alpha);
  const c = my + alpha * mx;
  return { c, alpha, beta, spread: DEFAULT_SPREAD, source: 'ia', n: 0, slopes: 'a-priori' };
}

export interface Fit {
  curve: PriceCurve;
  /** Points left out as implausible or as outliers. */
  dropped: number;
}

/**
 * Fits the curve of one model on its national listings.
 * - fewer than MIN_FOR_LEVEL usable listings: null (the prior curve stays);
 * - enough for the level only: slopes from the prior, level = robust median;
 * - large and spread sample: Huber regression with Gaussian priors on the slopes (MAP), clamped.
 */
export function fitMarket(points: Point[], prior: PriceCurve | null, now = new Date(), opts: { allowSlopes?: boolean } = {}): Fit | null {
  const base = { alpha: prior?.alpha ?? PRIOR.alpha, beta: prior?.beta ?? PRIOR.beta };
  const clean = points.filter((p) => p.price >= 300 && p.age >= 0 && !implausibleKm(p.km, p.age));
  let dropped = points.length - clean.length;
  if (clean.length < MIN_FOR_LEVEL) return null;

  const x1 = clean.map((p) => ln1p(p.age));
  const x2 = clean.map((p) => kmGap(p.km, p.age));
  const y = clean.map((p) => Math.log(p.price));
  const ages = clean.map((p) => p.age);
  const distinctYears = new Set(ages.map((a) => Math.round(a))).size;
  const span = Math.max(...ages) - Math.min(...ages);
  const freeSlopes = opts.allowSlopes !== false && clean.length >= MIN_FOR_SLOPES.n && distinctYears >= MIN_FOR_SLOPES.years && span >= MIN_FOR_SLOPES.span;

  let alpha = base.alpha;
  let beta = base.beta;
  let c = median(y.map((v, i) => v + alpha * x1[i] + beta * x2[i]));
  let weights = clean.map(() => 1);
  let s = DEFAULT_SPREAD;

  for (let iter = 0; iter < 12; iter++) {
    const resid = y.map((v, i) => v - (c - alpha * x1[i] - beta * x2[i]));
    s = Math.max(0.04, robustSd(resid));
    // Huber weights: full weight within 1.345·s, then decreasing.
    const k = 1.345 * s;
    weights = resid.map((r) => (Math.abs(r) <= k ? 1 : k / Math.abs(r)));
    if (!freeSlopes) {
      const offsets = y.map((v, i) => v + alpha * x1[i] + beta * x2[i]);
      const wsum = weights.reduce((a, b) => a + b, 0);
      c = offsets.reduce((a, v, i) => a + weights[i] * v, 0) / wsum;
      continue;
    }
    // MAP: minimise Σ wᵢ(yᵢ − c + α·x1ᵢ + β·x2ᵢ)²/s² + (α−α₀)²/σα² + (β−β₀)²/σβ².
    // Unknowns θ = (c, a = −α, b = −β), design (1, x1, x2).
    const la = s ** 2 / PRIOR.alphaSd ** 2;
    const lb = s ** 2 / PRIOR.betaSd ** 2;
    const A = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const B = [0, 0, 0];
    clean.forEach((_, i) => {
      const row = [1, x1[i], x2[i]];
      for (let r = 0; r < 3; r++) {
        B[r] += weights[i] * row[r] * y[i];
        for (let q = 0; q < 3; q++) A[r][q] += weights[i] * row[r] * row[q];
      }
    });
    A[1][1] += la;
    B[1] += la * -base.alpha;
    A[2][2] += lb;
    B[2] += lb * -base.beta;
    const theta = solve3(A, B);
    if (!theta) break;
    alpha = clamp(-theta[1], BOUNDS.alpha);
    beta = clamp(-theta[2], BOUNDS.beta);
    // Level refitted with the clamped slopes.
    const wsum = weights.reduce((a, b) => a + b, 0);
    c = y.reduce((a, v, i) => a + weights[i] * (v + alpha * x1[i] + beta * x2[i]), 0) / wsum;
  }

  // Gross outliers (a wreck, a typo in the price) do not count in the spread.
  const resid = y.map((v, i) => v - (c - alpha * x1[i] - beta * x2[i]));
  const kept = resid.filter((r) => Math.abs(r) <= 3 * s);
  dropped += resid.length - kept.length;
  const years = clean.map((p) => now.getFullYear() - Math.round(p.age));
  return {
    curve: {
      c,
      alpha,
      beta,
      spread: Math.max(0.05, robustSd(kept)),
      source: 'marche',
      n: kept.length,
      slopes: freeSlopes ? 'donnees' : 'a-priori',
      years: [Math.min(...years), Math.max(...years)],
      fittedAt: now.toISOString(),
    },
    dropped,
  };
}

/** Likely range of the market price around the curve (middle 50 % of listings). */
export function range(expected: number, spread: number): { low: number; high: number } {
  return { low: expected * Math.exp(-0.674 * spread), high: expected * Math.exp(0.674 * spread) };
}

const pct = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v * 100))} %`;

/** "−22 % la 1re année, −8 % la 5e ; −13 % à 120 000 km au lieu de 65 000 à 5 ans". */
export function describeCurve(curve: PriceCurve): string {
  const yearLoss = (age: number) => Math.pow((1 + age) / age, -curve.alpha) - 1;
  const kmEffect = Math.exp(-curve.beta * (ln1p(12) - ln1p(6.5))) - 1;
  return `${pct(yearLoss(1))} la 1re année, ${pct(yearLoss(5))} la 5e ; ${pct(kmEffect)} à 120 000 km au lieu de 65 000 (5 ans)`;
}
