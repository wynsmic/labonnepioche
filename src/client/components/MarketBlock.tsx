import { useState } from 'react';
import type { Estimate } from '../../shared/estimate';
import { laCentraleUrl } from '../../shared/market';
import type { StoredAd } from '../../shared/types';
import { api } from '../api';
import { capturePage, extensionReady } from '../extension';

const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

/** Asking price against a market value, as "−12 %" (cheaper) or "+8 %". */
function Diff({ price, value }: { price: number | null; value: number }) {
  if (price == null || !value) return null;
  const pct = Math.round(((price - value) / value) * 100);
  return <span className={pct <= -10 ? 'good' : pct > 0 ? 'bad' : 'muted'}>{pct > 0 ? `+${pct}` : pct} %</span>;
}

type LcState = { step: 'idle' } | { step: 'loading' } | { step: 'read' } | { step: 'error'; message: string };

/** Market value of the listing according to each available source. */
export function MarketBlock({ ad, estimate }: { ad: StoredAd; estimate: Estimate | null }) {
  const [lc, setLc] = useState<LcState>({ step: 'idle' });
  const lcUrl = laCentraleUrl(ad);
  const c = ad.comparison;
  const ai = ad.analysis?.market_price ?? null;

  const readLaCentrale = async () => {
    if (!lcUrl) return;
    setLc({ step: 'loading' });
    try {
      if (!(await extensionReady())) throw new Error('Extension Affaires introuvable dans ce navigateur.');
      const page = await capturePage(lcUrl);
      if (!page.ok) {
        throw new Error(
          page.reason === 'unknown-message'
            ? 'Recharge l’extension (version 0.2) dans chrome://extensions.'
            : page.reason === 'captcha'
              ? 'La Centrale a demandé une vérification. Réessaie.'
              : `Page illisible (${page.reason}).`,
        );
      }
      await api.capture('lacentrale', page.url, ad.id, JSON.stringify(page));
      setLc({ step: 'read' });
    } catch (e) {
      setLc({ step: 'error', message: (e as Error).message });
    }
  };

  return (
    <div className="market small">
      <strong>Cote du marché</strong>
      <table>
        <tbody>
          <tr>
            <th>Règles moyennes</th>
            <td>
              {estimate?.basis === 'annonces' ? (
                <>
                  {euro.format(Math.round(estimate.expected / 50) * 50)} <Diff price={ad.price} value={estimate.expected} />{' '}
                  <span className="muted">({estimate.peers} annonces collectées)</span>
                </>
              ) : (
                <span className="muted">pas assez d’annonces du même modèle</span>
              )}
            </td>
          </tr>
          <tr>
            <th>IA</th>
            <td>
              {ai != null ? (
                <>
                  {euro.format(ai)} <Diff price={ad.price} value={ai} />
                </>
              ) : (
                <span className="muted">après analyse</span>
              )}
            </td>
          </tr>
          <tr>
            <th>Leboncoin France</th>
            <td>
              {c ? (
                <>
                  médiane {euro.format(c.median)} <Diff price={ad.price} value={c.median} />{' '}
                  <span className="muted">
                    ({c.count} annonces, {c.match === 'motorisation' ? 'même motorisation' : 'même modèle'})
                  </span>
                </>
              ) : (
                <span className="muted">après « Vérifier »</span>
              )}
            </td>
          </tr>
          <tr>
            <th>La Centrale</th>
            <td>
              {lcUrl ? (
                <>
                  {lc.step === 'idle' && (
                    <button type="button" className="ghost small" onClick={readLaCentrale}>
                      Lire la cote
                    </button>
                  )}
                  {lc.step === 'loading' && <span className="muted">lecture…</span>}
                  {lc.step === 'read' && <span className="muted">page lue, décodage à venir</span>}
                  {lc.step === 'error' && <span className="bad">{lc.message}</span>}{' '}
                  <a href={lcUrl} target="_blank" rel="noreferrer">
                    Ouvrir ↗
                  </a>
                </>
              ) : (
                <span className="muted">marque, modèle ou année inconnus</span>
              )}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
