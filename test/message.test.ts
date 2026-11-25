import { describe, expect, it } from 'vitest';
import { sellerMessage } from '../server/domain/message';
import type { Facts } from '../server/domain/facts';
import type { SellerCheck } from '../server/domain/seller';
import type { StoredAd } from '../contracts/types';

const ad = (body: string, questions: string[] = [], extra: Partial<StoredAd> = {}): StoredAd =>
  ({
    id: '1', url: '', title: 'Toyota rav4', body, price: 22000, date: null, city: null, zipcode: null,
    lat: null, lng: null, image: null, seller: 'private', attributes: { brand: 'Toyota', model: 'RAV4' }, searchLabel: null, firstPrice: null,
    comparison: null, verification: null, sellerCheck: null, firstSeen: '', favorite: false, hidden: false,
    analysis: questions.length
      ? { id: '1', score: 70, verdict: 'bonne_affaire', market_price: null, new_price: null, summary: '', positives: [], red_flags: [], questions }
      : null,
    ...extra,
  }) as StoredAd;

const lines = (m: string) => m.split('\n').filter((l) => l.startsWith('- '));

describe('sellerMessage', () => {
  it('is short: one opening line, a few questions, thanks and signature', () => {
    const m = sellerMessage(ad('Vends RAV4.'));
    expect(m.startsWith('Bonjour,\n\nVotre annonce m’intéresse. Si le véhicule est toujours disponible, j’aurais quelques questions :')).toBe(true);
    expect(m).toContain('- est-ce qu’il y aura prochainement des frais à prévoir (entretien, pièces d’usure…) ?');
    expect(m.trim().endsWith('Merci à vous\n\ncdt\nMichael')).toBe(true);
    expect(lines(m).length).toBeLessThanOrEqual(4);
  });

  it('asks about a trade when the seller sells several cars, and for the Autoviza report', () => {
    const m = sellerMessage(
      ad('Vends RAV4.', [], {
        sellerCheck: { otherVehicles: 1 } as SellerCheck,
        attributes: { brand: 'Toyota', model: 'RAV4', vehicle_history_teaser_owners: '2' },
      }),
    );
    expect(lines(m)[0]).toBe('- vous vendez deux voitures : vous les avez eues pour un usage ou une revente pro ?');
    expect(m).toContain('- vous avez le rapport Autoviza ?');
  });

  it('skips what the listing settles and asks for a quote on an announced repair', () => {
    const facts = { accident: 'aucun', maintenance: 'complet', repairs: ['embrayage à changer'] } as unknown as Facts;
    const m = sellerMessage(ad('Carnet complet.', [], { facts }));
    expect(m).toContain('- l’annonce parle de « embrayage à changer » : vous avez un devis ?');
    expect(m).not.toContain('accidentée');
    expect(m).not.toContain('entretien a-t-il');
  });

  it('adds one analysis question at most, on a topic not already asked', () => {
    const m = sellerMessage(ad('Vends RAV4.', ['Frais à prévoir ?', 'Jusqu’à quand court la garantie Toyota', 'Le VIN ?']));
    expect(m).toContain('- jusqu’à quand court la garantie Toyota ?');
    expect(m).not.toContain('VIN');
  });
});
