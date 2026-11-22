import { numberFrom } from './compare';
import type { Ad } from './types';

/**
 * Quick estimate of the discount of a listing against its expected market price, with average
 * used-car rules (no AI, no extra request):
 * - every comparable listing collected for the hunt is brought back to a common basis
 *   (new, 0 km, no options) by dividing its price by its year, mileage and options factors;
 * - the median of those normalized prices, times this listing's own factors, is its expected price.
 * Falls back to the AI market estimate when too few comparable listings were collected.
 */
export interface Estimate {
  /** Positive = cheaper than expected (12 means 12 % under). */
  discount: number;
  expected: number;
  basis: 'annonces' | 'ia';
  peers: number;
  /** What moved the expected price, for the tooltip. */
  factors: string[];
}

export const MIN_PEERS = 4;

/** Average yearly loss of value (≈ 10 %/an in France for a mainstream car). */
const YEARLY = 0.9;
/** Mileage: ≈ −2.5 % per 10 000 km (exp(−km / 400 000)). */
const KM_SCALE = 400_000;

/** Signs in the text that move the price, in % (average effect, capped overall). */
const OPTION_RULES: { label: string; pct: number; re: RegExp }[] = [
  { label: 'première main', pct: 4, re: /\b(1(?:ere|re|er)|premiere) main\b/ },
  { label: 'entretien suivi', pct: 3, re: /\b(carnet d entretien|entretien (suivi|a jour|complet)|suivi (complet|concession|constructeur)|toutes les factures|historique d entretien)\b/ },
  { label: 'distribution faite', pct: 3, re: /\b(distribution|courroie)( de distribution)? (faite|changee|neuve|remplacee)\b/ },
  { label: 'boîte auto', pct: 5, re: /\b(boite auto(matique)?|bva|edc|dsg|eat ?\d)\b/ },
  { label: 'GPS', pct: 2, re: /\b(gps|navigation)\b/ },
  { label: 'caméra', pct: 2, re: /\bcamera\b/ },
  { label: 'toit ouvrant', pct: 2, re: /\btoit (ouvrant|panoramique)\b/ },
  { label: 'cuir', pct: 2, re: /\b(cuir|sellerie cuir)\b/ },
  { label: 'attelage', pct: 1, re: /\battelage\b/ },
  { label: 'pneus neufs', pct: 1, re: /\bpneus? (neufs?|recents?)\b/ },
  { label: 'CT OK', pct: 1, re: /\b(ct|controle technique) (ok|vierge|sans defaut)\b/ },
  { label: 'travaux à prévoir', pct: -6, re: /\ba prevoir\b/ },
  { label: 'voyant', pct: -6, re: /\bvoyants?\b/ },
  { label: 'fuite', pct: -6, re: /\bfuites?\b/ },
  { label: 'accident', pct: -10, re: /\b(accidentee?|choc)\b/ },
  { label: 'bruit', pct: -4, re: /\bbruits?\b/ },
  { label: 'carrosserie à reprendre', pct: -3, re: /\b(rayures?|bosses?|carrosserie a reprendre)\b/ },
];

const fold = (text: string) =>
  ` ${text.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ')} `;

function yearOf(ad: Ad): number | null {
  const y = Number(String(numberFrom(ad.attributes.regdate) ?? '').slice(0, 4));
  return y > 1950 ? y : null;
}

function options(ad: Ad): { factor: number; hits: { label: string; pct: number }[] } {
  const text = fold(`${ad.title} ${ad.body} ${ad.attributes.gearbox ?? ''}`);
  const hits = OPTION_RULES.filter((r) => r.re.test(text)).map(({ label, pct }) => ({ label, pct }));
  const plus = Math.min(12, hits.filter((h) => h.pct > 0).reduce((s, h) => s + h.pct, 0));
  const minus = Math.max(-25, hits.filter((h) => h.pct < 0).reduce((s, h) => s + h.pct, 0));
  return { factor: 1 + (plus + minus) / 100, hits };
}

/** Value of this listing relative to a new, 0 km, option-less one. */
function factor(ad: Ad, now: number) {
  const year = yearOf(ad);
  const km = numberFrom(ad.attributes.mileage);
  const age = year ? Math.max(0, now - year + 0.5) : null;
  const opt = options(ad);
  return {
    year,
    km,
    yearFactor: age != null ? YEARLY ** age : 1,
    kmFactor: km != null ? Math.exp(-km / KM_SCALE) : 1,
    opt,
    total: (age != null ? YEARLY ** age : 1) * (km != null ? Math.exp(-km / KM_SCALE) : 1) * opt.factor,
  };
}

const key = (ad: Ad) =>
  fold(`${ad.attributes.brand ?? ''} ${ad.attributes.model ?? ''}`).trim() || null;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const int = new Intl.NumberFormat('fr-FR');

/** Estimates for every listing, keyed by id (peers = the other collected listings of the same model and fuel). */
export function estimateAll(ads: Ad[], marketByAi: Map<string, number | null>, now = new Date().getFullYear()): Map<string, Estimate> {
  const usable = ads.filter((a) => a.price != null && a.price >= 500 && a.seller !== 'pro' && key(a));
  const groups = new Map<string, { ad: Ad; normalized: number; f: ReturnType<typeof factor> }[]>();
  for (const ad of usable) {
    const f = factor(ad, now);
    const g = `${key(ad)}|${(ad.attributes.fuel ?? '').toLowerCase()}`;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push({ ad, normalized: ad.price! / f.total, f });
  }

  const out = new Map<string, Estimate>();
  for (const ad of ads) {
    if (ad.price == null) continue;
    const f = factor(ad, now);
    const g = groups.get(`${key(ad)}|${(ad.attributes.fuel ?? '').toLowerCase()}`) ?? [];
    const peers = g.filter((p) => p.ad.id !== ad.id);
    let expected: number;
    let basis: Estimate['basis'];
    const factors: string[] = [];
    if (peers.length >= MIN_PEERS) {
      const base = median(peers.map((p) => p.normalized));
      expected = base * f.total;
      basis = 'annonces';
      // The same listing at the peers' median year and mileage, to explain the adjustments.
      const medYear = median(peers.map((p) => p.f.year).filter((y): y is number => y != null));
      const medKm = median(peers.map((p) => p.f.km).filter((k): k is number => k != null));
      const medPrice = median(peers.map((p) => p.ad.price!));
      factors.push(`Médiane de ${peers.length} annonces du même modèle : ${int.format(Math.round(medPrice))} €`);
      if (f.year && medYear) {
        const pct = Math.round((YEARLY ** (medYear - f.year) - 1) * 100);
        if (pct) factors.push(`Année ${f.year} vs ${Math.round(medYear)} : ${pct > 0 ? '+' : ''}${pct} %`);
      }
      if (f.km != null && medKm) {
        const pct = Math.round((Math.exp(-(f.km - medKm) / KM_SCALE) - 1) * 100);
        if (pct) factors.push(`${int.format(f.km)} km vs ${int.format(Math.round(medKm))} : ${pct > 0 ? '+' : ''}${pct} %`);
      }
    } else {
      const ai = marketByAi.get(ad.id);
      if (!ai) continue;
      expected = ai;
      basis = 'ia';
      factors.push(`Peu d’annonces du même modèle : prix de marché estimé par l’IA (${int.format(ai)} €)`);
    }
    if (basis === 'annonces') {
      for (const h of f.opt.hits) factors.push(`${h.label} : ${h.pct > 0 ? '+' : ''}${h.pct} %`);
    }
    factors.push(`Prix attendu ≈ ${int.format(Math.round(expected / 50) * 50)} €`);
    out.set(ad.id, {
      discount: Math.round(((expected - ad.price) / expected) * 100),
      expected: Math.round(expected),
      basis,
      peers: peers.length,
      factors,
    });
  }
  return out;
}
