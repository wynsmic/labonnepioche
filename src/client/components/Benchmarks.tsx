import { buildSearchUrl } from '../../shared/leboncoin';
import { numberFrom } from '../../shared/compare';
import type { StoredAd } from '../../shared/types';

const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const int = new Intl.NumberFormat('fr-FR');

function pct(value: number, reference: number): number {
  return Math.round(((value - reference) / reference) * 100);
}

function daysSince(date: string | null): number | null {
  if (!date) return null;
  const t = Date.parse(date.replace(' ', 'T'));
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

/** Prices of similar listings as dots on a line, this listing highlighted. */
function Strip({ prices, price, median }: { prices: number[]; price: number; median: number }) {
  const min = Math.min(prices[0], price);
  const max = Math.max(prices[prices.length - 1], price);
  const span = max - min || 1;
  const x = (v: number) => 6 + ((v - min) / span) * 188;
  return (
    <svg className="strip" viewBox="0 0 200 34" role="img" aria-label="Position du prix parmi les annonces similaires">
      <line x1="6" x2="194" y1="17" y2="17" className="strip-axis" />
      {prices.map((p, i) => (
        <circle key={i} cx={x(p)} cy="17" r="3" className="strip-dot" />
      ))}
      <line x1={x(median)} x2={x(median)} y1="8" y2="26" className="strip-median" />
      <circle cx={x(price)} cy="17" r="5.5" className="strip-me" />
      <text x="6" y="33" className="strip-label">
        {int.format(min)}
      </text>
      <text x="194" y="33" textAnchor="end" className="strip-label">
        {int.format(max)}
      </text>
    </svg>
  );
}

/** Evidence that a listing is (or is not) a real deal. */
export function Benchmarks({
  ad,
  busy,
  onCompare,
}: {
  ad: StoredAd;
  busy: boolean;
  onCompare: () => void;
}) {
  const c = ad.comparison;
  const price = ad.price;
  const mileage = numberFrom(ad.attributes.mileage);
  const year = numberFrom(ad.attributes.regdate);
  const days = daysSince(ad.date);
  const drop = ad.firstPrice != null && price != null && ad.firstPrice > price ? ad.firstPrice - price : 0;
  const ai = ad.analysis?.market_price ?? null;

  return (
    <aside className="bench" aria-label="Repères">
      <strong className="small">Repères</strong>

      {c && price != null ? (
        <>
          <div className={`bench-big ${price < c.median ? 'good' : 'bad'}`}>
            {pct(price, c.median) > 0 ? '+' : ''}
            {pct(price, c.median)} %<span className="small"> vs médiane France</span>
          </div>
          <div className="small">
            Moins cher que <strong>{c.cheaperThan} %</strong> des {c.count} annonces similaires
          </div>
          <Strip prices={c.prices} price={price} median={c.median} />
          <div className="small muted">
            Médiane {euro.format(c.median)} · habituel {euro.format(c.p25)}–{euro.format(c.p75)}
          </div>
          {mileage != null && c.medianMileage != null && (
            <div className={`small ${mileage <= c.medianMileage ? 'good' : 'bad'}`}>
              {int.format(mileage)} km vs {int.format(c.medianMileage)} km médian
            </div>
          )}
          {year != null && c.medianYear != null && year !== c.medianYear && (
            <div className={`small ${year > c.medianYear ? 'good' : 'bad'}`}>
              {year} vs {c.medianYear} médian
            </div>
          )}
          <details className="small">
            <summary>Les moins chères en France</summary>
            <ul className="cheapest">
              {c.cheapest.map((x) => (
                <li key={x.url}>
                  <a href={x.url} target="_blank" rel="noreferrer">
                    {euro.format(x.price)}
                  </a>{' '}
                  · {x.year ?? '?'} · {x.mileage != null ? `${int.format(x.mileage)} km` : '?'} · {x.city ?? ''}
                </li>
              ))}
            </ul>
          </details>
          <div className="row small">
            <a href={buildSearchUrl(c.query, null)} target="_blank" rel="noreferrer">
              Recherche nationale ↗
            </a>
            <button type="button" className="ghost small" disabled={busy} onClick={onCompare}>
              {busy ? '…' : 'Actualiser'}
            </button>
          </div>
        </>
      ) : (
        <button type="button" className="small" disabled={busy || price == null} onClick={onCompare}>
          {busy ? 'Comparaison en France…' : 'Situer le prix en France'}
        </button>
      )}

      {ai != null && price != null && (
        <div className={`small ${price < ai ? 'good' : 'bad'}`}>
          Marché estimé (IA) {euro.format(ai)} ({pct(price, ai) > 0 ? '+' : ''}
          {pct(price, ai)} %)
        </div>
      )}
      {drop > 0 && <div className="small good">Baisse de {euro.format(drop)} depuis la 1re lecture</div>}
      {days != null && (
        <div className="small muted">
          En ligne depuis {days} j{days >= 30 ? ' : vendeur peut-être ouvert à la négociation' : ''}
        </div>
      )}
      {ad.seller === 'private' && <div className="small muted">Particulier (pas de marge de pro)</div>}
    </aside>
  );
}
