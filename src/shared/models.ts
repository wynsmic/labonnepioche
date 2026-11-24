import type { Ad, Pick, Plan } from './types';

const fold = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Words in many choices' names that tell nothing about which one a listing is. */
const GENERIC = new Set(['hybride', 'hybrid', 'essence', 'diesel', 'electrique', 'break', 'sw', 'wagon', 'touring', 'sports', 'auto', 'automatique']);

/** Plans saved before tagline, tags and trims existed lack them. */
export type ModelCard = Pick & Partial<{ tagline: string; tags: string[]; trims: { name: string; note: string }[] }>;

/**
 * The shortlist choice a listing belongs to: the one its search targets, otherwise the choice whose
 * name shares the most words with the listing's make, model and title.
 */
export function pickOf(plan: Plan | null | undefined, ad: Ad & { searchLabel?: string | null }): ModelCard | null {
  const shortlist = (plan?.shortlist ?? []) as ModelCard[];
  if (!shortlist.length) return null;
  const target = plan?.searches.find((s) => s.label === ad.searchLabel)?.pick;
  const named = target ? shortlist.find((p) => fold(p.name) === fold(target)) : undefined;
  if (named) return named;

  // The model Leboncoin states ("RAV4") decides first: make and fuel words are shared by many choices.
  const model = fold(ad.attributes.model ?? ad.attributes.u_car_model ?? '');
  const candidates = model ? shortlist.filter((p) => ` ${fold(p.name)} `.includes(` ${model} `)) : [];
  if (candidates.length === 1) return candidates[0];

  const words = new Set(
    fold(`${ad.attributes.brand ?? ''} ${ad.attributes.model ?? ''} ${ad.title}`)
      .split(' ')
      .filter((w) => w.length > 1 && !GENERIC.has(w)),
  );
  let best: ModelCard | null = null;
  let bestScore = 0;
  let tie = false;
  for (const p of candidates.length ? candidates : shortlist) {
    const score = fold(p.name)
      .split(' ')
      .filter((w) => words.has(w)).length;
    if (score > bestScore) [best, bestScore, tie] = [p, score, false];
    else if (score === bestScore && score > 0) tie = true;
  }
  // One shared word (often the make) is not enough to tell two choices apart, nor is a tie.
  if (tie) return null;
  return bestScore >= 2 || (bestScore === 1 && (shortlist.length === 1 || candidates.length > 0)) ? best : null;
}

/** The trim the listing states (Leboncoin field, else a known trim named in the title), with what it means. */
export function trimOf(ad: Ad, pick: ModelCard | null): { name: string; note: string | null } | null {
  const trims = pick?.trims ?? [];
  const stated = ad.attributes.u_car_finition?.trim();
  // Longest names first: "GR Sport" before "Sport".
  const longestFirst = [...trims].sort((a, b) => b.name.length - a.name.length);
  const within = (text: string) => longestFirst.find((t) => ` ${fold(text)} `.includes(` ${fold(t.name)} `));
  // "Pack Business" on Leboncoin reads as the plan's "Business".
  if (stated) return { name: stated, note: within(stated)?.note ?? null };
  const named = within(ad.title);
  return named ? { name: named.name, note: named.note } : null;
}

export interface Fact {
  label: string;
  value: string;
  /** Short context shown under the value ("hors 2019–2022"). */
  hint?: string;
  tone?: 'good' | 'warn';
}

const int = new Intl.NumberFormat('fr-FR');

/**
 * Year, mileage, engine and gearbox, labelled.
 * The years of the shortlist choice, when known, tell whether the listing's year is in range.
 */
export function keyFacts(ad: Ad, pick: ModelCard | null = null): Fact[] {
  const a = ad.attributes;
  const facts: Fact[] = [];
  const dated = a.issuance_date?.match(/^(\d{2})\/(\d{4})$/);
  const year = dated ? Number(dated[2]) : Number(a.regdate?.match(/\d{4}/)?.[0]) || null;
  if (year) {
    const range = pick?.years.match(/(\d{4})\D+(\d{4})/);
    const out = range ? year < Number(range[1]) || year > Number(range[2]) : false;
    facts.push({
      label: 'Année',
      value: dated ? `${dated[1]}/${dated[2]}` : String(year),
      ...(out ? { hint: `hors ${range![1]}–${range![2]}`, tone: 'warn' as const } : {}),
    });
  }
  const km = a.mileage ? Number(a.mileage.replace(/\D/g, '')) : null;
  if (km != null && Number.isFinite(km)) facts.push({ label: 'Kilométrage', value: `${int.format(km)} km` });
  const power = a.horse_power_din?.replace(/\s*ch$/i, ' ch');
  const engine = [a.fuel, power].filter(Boolean).join(' ');
  if (engine) facts.push({ label: 'Moteur', value: engine });
  if (a.gearbox) facts.push({ label: 'Boîte', value: /auto/i.test(a.gearbox) ? 'Boîte auto' : /manu/i.test(a.gearbox) ? 'Boîte manuelle' : `Boîte ${a.gearbox.toLowerCase()}` });
  return facts;
}
