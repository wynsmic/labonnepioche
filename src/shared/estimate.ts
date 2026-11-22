import { numberFrom } from './compare';
import type { Ad } from './types';
import { PRIOR, adjustPrice, describeCurve, fitCurve } from './depreciation';

/**
 * Quick estimate of the discount of a listing against its expected market price, with average
 * used-car rules (no AI, no extra request):
 * - every collected listing of the same model is brought to this listing's year and mileage with
 *   the depreciation law (fitted on those listings when there are enough, see depreciation.ts),
 *   and to its equipment with the options rules;
 * - the median of those adjusted prices is its expected price.
 * Sources by reliability: the national comparison when "Vérifier" ran, else those collected
 * listings, else the AI market estimate, else the AI new price minus average depreciation.
 */
export interface Estimate {
  /** Positive = cheaper than expected (12 means 12 % under). */
  discount: number;
  expected: number;
  /**
   * Most reliable first: france = national comparison of "Vérifier" (same engine, adjusted);
   * annonces = collected listings of the same model; ia = AI market estimate for this listing;
   * neuf = AI new price minus average depreciation (crude, last resort).
   */
  basis: 'france' | 'annonces' | 'ia' | 'neuf';
  peers: number;
  /** What moved the expected price, for the tooltip. */
  factors: string[];
}

export const MIN_PEERS = 4;

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

const kmOf = (ad: Ad) => numberFrom(ad.attributes.mileage);

const key = (ad: Ad) =>
  fold(`${ad.attributes.brand ?? ''} ${ad.attributes.model ?? ''}`).trim() || null;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const int = new Intl.NumberFormat('fr-FR');

/** Estimates for every listing, keyed by id (peers = the other collected listings of the same model and fuel). */
/** A new car loses about this much the day it becomes used (dealer exit). */
const DEALER_EXIT = 0.9;
/** Beyond this age the new price says little about the value. */
const MAX_AGE_FROM_NEW = 15;

/** Average yearly mileage: the age law already assumes it, only the gap to it is corrected. */
const NORMAL_KM_PER_YEAR = 13_000;

export interface KnownPrices {
  /** Median of the national comparison, brought to this listing's year and mileage. */
  france: { median: number; count: number } | null;
  market: number | null;
  newPrice: number | null;
}

export function estimateAll(ads: Ad[], ai: Map<string, KnownPrices>, now = new Date().getFullYear()): Map<string, Estimate> {
  const groupOf = (ad: Ad) => `${key(ad)}|${(ad.attributes.fuel ?? '').toLowerCase()}`;
  const usable = ads.filter((a) => a.price != null && a.price >= 500 && a.seller !== 'pro' && key(a));
  const groups = new Map<string, Ad[]>();
  for (const ad of usable) {
    const g = groupOf(ad);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(ad);
  }
  const curves = new Map(
    [...groups].map(([g, list]) => [g, fitCurve(list.map((a) => ({ price: a.price!, year: yearOf(a), km: kmOf(a) })))]),
  );

  const out = new Map<string, Estimate>();
  for (const ad of ads) {
    if (ad.price == null) continue;
    const peers = (groups.get(groupOf(ad)) ?? []).filter((p) => p.id !== ad.id);
    const opt = options(ad);
    const to = { year: yearOf(ad), km: kmOf(ad) };
    let expected: number;
    let basis: Estimate['basis'];
    const factors: string[] = [];
    const prices = ai.get(ad.id);
    if (prices?.france) {
      // Same number as the check's "vs médiane France": one market reference everywhere.
      expected = prices.france.median;
      basis = 'france';
      factors.push(`Médiane de ${prices.france.count} annonces comparables en France, ramenées à cette année et ce kilométrage`);
    } else if (peers.length >= MIN_PEERS) {
      const curve = curves.get(groupOf(ad))!;
      const adjusted = peers.map(
        (p) => (adjustPrice(p.price!, { year: yearOf(p), km: kmOf(p) }, to, curve) / options(p).factor) * opt.factor,
      );
      expected = median(adjusted);
      basis = 'annonces';
      const medYear = median(peers.map(yearOf).filter((y): y is number => y != null));
      const medKm = median(peers.map(kmOf).filter((k): k is number => k != null));
      factors.push(`Médiane de ${peers.length} annonces du même modèle : ${int.format(Math.round(median(peers.map((p) => p.price!))))} €`);
      factors.push(`Loi de décote : ${describeCurve(curve)}`);
      if (to.year && medYear) {
        const pct = Math.round((Math.exp(curve.perYear * (medYear - to.year)) - 1) * 100);
        if (pct) factors.push(`Année ${to.year} vs ${Math.round(medYear)} : ${pct > 0 ? '+' : ''}${pct} %`);
      }
      if (to.km != null && medKm) {
        const pct = Math.round((Math.exp((curve.per10kKm * (to.km - medKm)) / 10_000) - 1) * 100);
        if (pct) factors.push(`${int.format(to.km)} km vs ${int.format(Math.round(medKm))} : ${pct > 0 ? '+' : ''}${pct} %`);
      }
      for (const h of opt.hits) factors.push(`${h.label} : ${h.pct > 0 ? '+' : ''}${h.pct} %`);
    } else if (prices?.market) {
      expected = prices.market;
      basis = 'ia';
      factors.push(`Peu d’annonces du même modèle : prix de marché de cette annonce estimé par l’IA`);
    } else {
      const age = to.year ? Math.max(0, now - to.year + 0.5) : null;
      if (!prices?.newPrice || age == null || age > MAX_AGE_FROM_NEW) continue;
      // The new car brought to this age with the market-average law, which already assumes a
      // normal mileage: only the gap to that mileage is corrected.
      const ageFactor = Math.exp(PRIOR.perYear * age);
      const kmGap = to.km != null ? to.km - age * NORMAL_KM_PER_YEAR : 0;
      const kmFactor = Math.exp((PRIOR.per10kKm * kmGap) / 10_000);
      expected = prices.newPrice * DEALER_EXIT * ageFactor * kmFactor * opt.factor;
      basis = 'neuf';
      const pct = (f: number) => `${Math.round((f - 1) * 100)} %`;
      factors.push(`Estimation grossière depuis le prix neuf (IA) ${int.format(prices.newPrice)} €`);
      factors.push(`Sortie de concession : ${pct(DEALER_EXIT)}`);
      factors.push(`${Math.floor(age)} ans : ${pct(ageFactor)}`);
      if (kmGap) factors.push(`${int.format(Math.abs(Math.round(kmGap)))} km ${kmGap > 0 ? 'de plus' : 'de moins'} que la normale : ${pct(kmFactor)}`);
      for (const h of opt.hits) factors.push(`${h.label} : ${h.pct > 0 ? '+' : ''}${h.pct} %`);
    }
    factors.push(`Prix attendu ≈ ${int.format(Math.round(expected / 50) * 50)} €`);
    out.set(ad.id, {
      discount: Math.round(((expected - ad.price) / expected) * 100),
      expected: Math.round(expected),
      basis,
      peers: basis === 'france' ? prices!.france!.count : peers.length,
      factors,
    });
  }
  return out;
}
