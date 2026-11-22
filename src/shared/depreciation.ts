/**
 * How a used car's price moves with age and mileage, as a log-linear law:
 *   log(price) = a + perYear × age + per10kKm × (km / 10 000)
 * The prior is the usual French market average (≈ −10 %/year, ≈ −2.5 % per 10 000 km). When enough
 * listings of the same model are at hand, the law is fitted on them and blended with the prior
 * (a few listings barely move it, many listings dominate it), within plausible bounds.
 */
export interface Curve {
  /** Log change per year of age (negative). */
  perYear: number;
  /** Log change per 10 000 km (negative). */
  per10kKm: number;
  /** Number of listings the law was fitted on (0 = prior only). */
  fittedOn: number;
}

export const PRIOR: Curve = { perYear: Math.log(0.9), per10kKm: -0.025, fittedOn: 0 };

const MIN_FIT = 10;
/** Weight of the prior, in listings. */
const PRIOR_WEIGHT = 15;
const BOUNDS = { perYear: [Math.log(0.75), Math.log(0.97)], per10kKm: [-0.07, -0.005] } as const;

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));

export interface Point {
  price: number;
  year: number | null;
  km: number | null;
}

/** Least squares of log(price) on year and km, blended with the prior. */
export function fitCurve(points: Point[]): Curve {
  const pts = points.filter((p) => p.price > 0 && p.year != null && p.km != null) as Required<Point>[];
  const n = pts.length;
  if (n < MIN_FIT) return PRIOR;
  const mean = (f: (p: (typeof pts)[number]) => number) => pts.reduce((s, p) => s + f(p), 0) / n;
  const my = mean((p) => p.year!);
  const mk = mean((p) => p.km! / 10_000);
  const ml = mean((p) => Math.log(p.price));
  let syy = 0, skk = 0, syk = 0, syl = 0, skl = 0;
  for (const p of pts) {
    const y = p.year! - my;
    const k = p.km! / 10_000 - mk;
    const l = Math.log(p.price) - ml;
    syy += y * y; skk += k * k; syk += y * k; syl += y * l; skl += k * l;
  }
  const det = syy * skk - syk * syk;
  if (det <= 1e-9) return PRIOR;
  // A newer car (higher year) is worth more: the slope on year is minus the slope on age.
  const perYear = -((syl * skk - skl * syk) / det);
  const per10kKm = (skl * syy - syl * syk) / det;
  const blend = (fit: number, prior: number) => (n * fit + PRIOR_WEIGHT * prior) / (n + PRIOR_WEIGHT);
  return {
    perYear: clamp(blend(perYear, PRIOR.perYear), BOUNDS.perYear),
    per10kKm: clamp(blend(per10kKm, PRIOR.per10kKm), BOUNDS.per10kKm),
    fittedOn: n,
  };
}

/** Price of a car brought to another year and mileage (unknown values are left as they are). */
export function adjustPrice(price: number, from: Omit<Point, 'price'>, to: Omit<Point, 'price'>, curve: Curve): number {
  let log = 0;
  if (from.year != null && to.year != null) log += curve.perYear * (from.year - to.year);
  if (from.km != null && to.km != null) log += (curve.per10kKm * (to.km - from.km)) / 10_000;
  return price * Math.exp(log);
}

/** "−9 %/an, −2,1 % par 10 000 km". */
export function describeCurve(c: Curve): string {
  const pct = (log: number) => `${((Math.exp(log) - 1) * 100).toFixed(1).replace('.', ',')} %`;
  return `${pct(c.perYear)} par an, ${pct(c.per10kKm)} par 10 000 km${c.fittedOn ? ` (mesuré sur ${c.fittedOn} annonces)` : ' (moyenne du marché)'}`;
}
