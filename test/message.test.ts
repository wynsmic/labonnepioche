import { describe, expect, it } from 'vitest';
import { sellerMessage } from '../src/shared/message';
import type { StoredAd } from '../src/shared/types';

const ad = (body: string, questions: string[] = []): StoredAd =>
  ({
    id: '1', url: '', title: 'Toyota RAV4 Hybride 2019', body, price: 22000, date: null, city: null, zipcode: null,
    lat: null, lng: null, image: null, seller: 'private', attributes: {}, searchLabel: null, firstPrice: null,
    comparison: null, verification: null, sellerCheck: null, firstSeen: '', favorite: false, hidden: false,
    analysis: questions.length
      ? { id: '1', score: 70, verdict: 'bonne_affaire', market_price: null, new_price: null, summary: '', positives: [], red_flags: [], questions }
      : null,
  }) as StoredAd;

describe('sellerMessage', () => {
  it('asks the usual questions about a bare listing', () => {
    const m = sellerMessage(ad('Vends RAV4.'));
    expect(m).toContain('« Toyota RAV4 Hybride 2019 »');
    expect(m).toContain('contrôle technique');
    expect(m).toContain('accidenté');
    expect(m).toContain('Où peut-on voir le véhicule');
  });

  it('skips what the listing already answers', () => {
    const m = sellerMessage(ad('CT OK, jamais accidentée, carnet d’entretien Toyota, origine française.'));
    expect(m).not.toContain('contrôle technique est bon');
    expect(m).not.toContain('accidenté');
    expect(m).not.toContain('importé');
    expect(m).not.toContain('historique d’entretien');
  });

  it('adds the analysis questions without doubling a topic', () => {
    const m = sellerMessage(ad('Vends RAV4.', ['Que signifie SOH 76 % ?', 'CT fait avant vente ?', 'Toyota Relax encore valide']));
    expect(m).toContain('- Que signifie SOH 76 % ?');
    expect(m).toContain('- Toyota Relax encore valide ?');
    expect(m).not.toContain('CT fait avant vente');
  });
});
