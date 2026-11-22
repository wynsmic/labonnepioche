import type { Estimate } from '../../shared/estimate';
import type { StoredAd } from '../../shared/types';

const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

/** Asking price against a market value, as "−12 %" (cheaper) or "+8 %". */
function Diff({ price, value }: { price: number | null; value: number }) {
  if (price == null || !value) return null;
  const pct = Math.round(((price - value) / value) * 100);
  return <span className={pct <= -10 ? 'good' : pct > 0 ? 'bad' : 'muted'}>{pct > 0 ? `+${pct}` : pct} %</span>;
}

/** Market value of the listing according to each available source. */
export function MarketBlock({ ad, estimate }: { ad: StoredAd; estimate: Estimate | null }) {
  const c = ad.comparison;
  const ai = ad.analysis?.market_price ?? null;

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
        </tbody>
      </table>
    </div>
  );
}
