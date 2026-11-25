import { describe, expect, it } from 'vitest';
import { PRIOR, ageFrom, curveFromPoints, describeCurve, fitMarket, implausibleKm, predict, project, type PriceCurve, type Point } from '../server/domain/pricing';

const truth: PriceCurve = { c: Math.log(32_000), alpha: 0.45, beta: 0.32, spread: 0.1, source: 'marche', n: 0, slopes: 'donnees' };

/** Deterministic pseudo-random numbers. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32;
    return s / 2 ** 32;
  };
}

function sample(n: number, ages: [number, number], seed = 1, noise = 0.08): Point[] {
  const r = rng(seed);
  return Array.from({ length: n }, () => {
    const age = ages[0] + r() * (ages[1] - ages[0]);
    const km = Math.round(13_000 * age * (0.5 + r()));
    const gauss = (r() + r() + r() - 1.5) * 2 * noise;
    return { age, km, price: Math.round(predict(truth, age, km) * Math.exp(gauss)) };
  });
}

describe('prior curve', () => {
  it('reproduces the French market table (≈ −22 % the 1st year, slowing down)', () => {
    const curve = curveFromPoints([{ age: 0, km: 0, price: 30_000 }])!;
    expect(curve.alpha).toBeCloseTo(PRIOR.alpha, 5);
    const loss = (age: number) => 1 - predict(curve, age, 13_000 * age) / predict(curve, age - 1, 13_000 * (age - 1));
    expect(loss(1)).toBeGreaterThan(0.18);
    expect(loss(1)).toBeLessThan(0.26);
    expect(loss(2)).toBeLessThan(loss(1));
    expect(loss(5)).toBeLessThan(0.09);
    expect(describeCurve(curve)).toMatch(/−22 % la 1re année/);
  });

  it('follows the AI price points for the level and pulls the slope towards the prior', () => {
    const points = [1, 3, 5, 8].map((age) => ({ age, km: 13_000 * age, price: Math.round(predict(truth, age, 13_000 * age)) }));
    const curve = curveFromPoints(points)!;
    expect(curve.alpha).toBeGreaterThan(PRIOR.alpha);
    expect(curve.alpha).toBeLessThan(truth.alpha + 0.01);
    expect(predict(curve, 4, 52_000) / predict(truth, 4, 52_000)).toBeCloseTo(1, 1);
  });
});

describe('market fit', () => {
  it('recovers the slopes from a large and spread sample', () => {
    const fit = fitMarket(sample(150, [1, 9]), null)!;
    expect(fit.curve.slopes).toBe('donnees');
    expect(fit.curve.alpha).toBeGreaterThan(0.38);
    expect(fit.curve.alpha).toBeLessThan(0.52);
    expect(fit.curve.beta).toBeGreaterThan(0.2);
    expect(fit.curve.beta).toBeLessThan(0.42);
    expect(predict(fit.curve, 5, 65_000) / predict(truth, 5, 65_000)).toBeCloseTo(1, 1);
  });

  it('keeps the prior slopes on a narrow sample and only learns the level', () => {
    const fit = fitMarket(sample(40, [4, 5.5]), null)!;
    expect(fit.curve.slopes).toBe('a-priori');
    expect(fit.curve.alpha).toBe(PRIOR.alpha);
    expect(predict(fit.curve, 4.8, 62_000) / predict(truth, 4.8, 62_000)).toBeCloseTo(1, 1);
  });

  it('is not pulled by wrecks, price typos and fake mileages', () => {
    const points = sample(60, [1, 9], 3);
    points.push({ age: 3, km: 40_000, price: 1_500 }, { age: 4, km: 250, price: 22_000 }, { age: 2, km: 30_000, price: 250_000 });
    const fit = fitMarket(points, null)!;
    expect(fit.dropped).toBeGreaterThanOrEqual(3);
    expect(predict(fit.curve, 5, 65_000) / predict(truth, 5, 65_000)).toBeCloseTo(1, 1);
  });

  it('says nothing under 8 usable listings', () => {
    expect(fitMarket(sample(6, [2, 6]), null)).toBeNull();
  });
});

it('projects a price to another age and mileage along the curve', () => {
  const p = project(truth, 20_000, { age: 6, km: 90_000 }, { age: 4, km: 50_000 });
  expect(p).toBeGreaterThan(20_000);
  expect(p / 20_000).toBeCloseTo(predict(truth, 4, 50_000) / predict(truth, 6, 90_000), 6);
});

it('flags mileages that cannot be true', () => {
  expect(implausibleKm(250, 5)).toBe(true);
  expect(implausibleKm(85_000, 5)).toBe(false);
  expect(implausibleKm(700_000, 12)).toBe(true);
});

it('reads the age from the first registration date', () => {
  const now = Date.UTC(2026, 10, 15);
  expect(ageFrom({ issuance_date: '11/2021' }, now)).toBeCloseTo(5, 1);
  expect(ageFrom({ regdate: '2020' }, now)).toBeCloseTo(6.37, 1);
});
