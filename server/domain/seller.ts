import { z } from 'zod';
import type { SellerCheck } from '../../contracts/types';

export type { SellerCheck };

/** What the extension reads on a seller's public profile page. */
export const SellerProfileSchema = z.object({
  memberSince: z.string().max(60).nullable(),
  totalAds: z.number().int().nonnegative().nullable(),
  badges: z.array(z.string().max(40)).max(10),
  ads: z
    .array(
      z.object({
        title: z.string().max(300),
        price: z.number().nullable(),
        category: z.string().max(80).nullable(),
        date: z.string().max(40).nullable(),
      }),
    )
    .max(60),
});
export type SellerProfile = z.infer<typeof SellerProfileSchema>;


/** A listing this far under its market (in %) gets its seller checked. */
export const SELLER_CHECK_DISCOUNT = 15;

export const profileUrl = (sellerId: string) => `https://www.leboncoin.fr/profile/${sellerId}/offers`;

const MONTHS: Record<string, number> = {
  janvier: 0, fevrier: 1, mars: 2, avril: 3, mai: 4, juin: 5, juillet: 6, aout: 7, septembre: 8, octobre: 9,
  novembre: 10, decembre: 11, janv: 0, fevr: 1, avr: 3, juil: 6, sept: 8, oct: 9, nov: 10, dec: 11,
};

/** "octobre 2015" -> 1 Oct 2015; "2015" -> 1 Jan 2015. */
export function parseMemberSince(text: string | null): Date | null {
  if (!text) return null;
  const t = text.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
  const year = Number(t.match(/\b(19|20)\d{2}\b/)?.[0]);
  if (!year) return null;
  const month = Object.entries(MONTHS).find(([name]) => new RegExp(`\\b${name}\\.?\\b`).test(t))?.[1] ?? 0;
  return new Date(Date.UTC(year, month, 1));
}

const VEHICLE = /voiture|moto|utilitaire|camping|caravan/i;
const VALUABLE = /t[ée]l[ée]phone|console|informatique|ordinateur|tablette|photo|image|son|montre|bijou|v[ée]lo/i;

/** Signs that a too-good deal comes from a fresh or business-like account (average rules). */
export function assessSeller(profile: SellerProfile, url: string, adTitle: string, now = Date.now()): SellerCheck {
  const since = parseMemberSince(profile.memberSince);
  const ageDays = since ? Math.max(0, Math.floor((now - since.getTime()) / 86_400_000)) : null;
  const others = profile.ads.filter((a) => a.title.trim() !== adTitle.trim());
  const otherVehicles = others.filter((a) => VEHICLE.test(a.category ?? '')).length;
  const valuables = others.filter((a) => (a.price ?? 0) >= 300 && VALUABLE.test(a.category ?? '')).length;
  const total = profile.totalAds ?? profile.ads.length;

  const flags: { text: string; level: 'attention' | 'suspect' }[] = [];
  if (ageDays == null) flags.push({ text: 'Ancienneté du compte non lue', level: 'attention' });
  else if (ageDays < 31) flags.push({ text: `Compte créé ce mois-ci (${profile.memberSince})`, level: 'suspect' });
  else if (ageDays < 183) flags.push({ text: `Compte récent (${profile.memberSince})`, level: 'attention' });
  if (ageDays != null && ageDays < 92 && total <= 1) flags.push({ text: 'Compte neuf avec cette seule annonce', level: 'suspect' });
  if (otherVehicles >= 6) flags.push({ text: `${otherVehicles} autres véhicules en vente : marchand non déclaré`, level: 'suspect' });
  else if (otherVehicles >= 3) flags.push({ text: `${otherVehicles} autres véhicules en vente : revendeur ?`, level: 'attention' });
  if (valuables >= 4) flags.push({ text: `${valuables} objets de valeur en vente : activité de revente ?`, level: 'attention' });
  if (!profile.badges.length && (ageDays == null || ageDays < 365)) flags.push({ text: 'Aucune vérification affichée', level: 'attention' });

  return {
    at: new Date(now).toISOString(),
    profileUrl: url,
    memberSince: profile.memberSince,
    accountAgeDays: ageDays,
    totalAds: total || null,
    otherVehicles,
    badges: profile.badges,
    level: flags.some((f) => f.level === 'suspect') ? 'suspect' : flags.length ? 'attention' : 'ok',
    flags: flags.map((f) => f.text),
  };
}
