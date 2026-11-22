import { useState } from 'react';
import { buildSearchUrl } from '../../shared/leboncoin';
import { comparableQuery, numberFrom } from '../../shared/compare';
import { verdictOf, type Search, type StoredAd } from '../../shared/types';
import type { Estimate } from '../../shared/estimate';
import { describeCurve } from '../../shared/depreciation';
import { SELLER_CHECK_DISCOUNT } from '../../shared/seller';

const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const int = new Intl.NumberFormat('fr-FR');

function pct(value: number, reference: number): number {
  return Math.round(((value - reference) / reference) * 100);
}

/** "il y a 5 h" / "il y a 2 j" for the reuse of national listings. */
function readAgo(iso: string): string {
  const hours = (Date.now() - Date.parse(iso)) / 3_600_000;
  return hours < 24 ? `il y a ${Math.max(1, Math.round(hours))} h` : `il y a ${Math.floor(hours / 24)} j`;
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

/** The national search to compare with, editable before it runs. */
function CompareForm({
  initial,
  busy,
  onRun,
  onCancel,
}: {
  initial: Search;
  busy: boolean;
  onRun: (query: Search) => void;
  onCancel: () => void;
}) {
  const [q, setQ] = useState(initial);
  const num = (v: string) => (v.trim() ? Number(v) : null);
  return (
    <form
      className="compare-form small"
      onSubmit={(e) => {
        e.preventDefault();
        onRun({ ...q, text: q.text.trim() });
      }}
    >
      <label>
        Mots-clés
        <input value={q.text} onChange={(e) => setQ({ ...q, text: e.target.value })} />
      </label>
      <div className="pair">
        <label>
          Année de
          <input inputMode="numeric" value={q.regdate_min ?? ''} onChange={(e) => setQ({ ...q, regdate_min: num(e.target.value) })} />
        </label>
        <label>
          à
          <input inputMode="numeric" value={q.regdate_max ?? ''} onChange={(e) => setQ({ ...q, regdate_max: num(e.target.value) })} />
        </label>
      </div>
      <div className="pair">
        <label>
          Km de
          <input inputMode="numeric" value={q.mileage_min ?? ''} onChange={(e) => setQ({ ...q, mileage_min: num(e.target.value) })} />
        </label>
        <label>
          à
          <input inputMode="numeric" value={q.mileage_max ?? ''} onChange={(e) => setQ({ ...q, mileage_max: num(e.target.value) })} />
        </label>
      </div>
      <div className="row">
        <button type="submit" className="primary small" disabled={busy || !q.text.trim()}>
          Vérifier
        </button>
        <button type="button" className="ghost small" onClick={onCancel}>
          Annuler
        </button>
      </div>
    </form>
  );
}

/** Asking price against a market value, as "−12 %" (cheaper) or "+8 %". */
function Diff({ price, value }: { price: number | null; value: number }) {
  if (price == null || !value) return null;
  const d = pct(price, value);
  return <span className={d <= -10 ? 'good' : d > 0 ? 'bad' : 'muted'}>{d > 0 ? `+${d}` : d} %</span>;
}

const BASIS_LABEL: Record<Estimate['basis'], (e: Estimate) => string> = {
  france: (e) => `médiane France · ${e.peers} annonces`,
  annonces: (e) => `${e.peers} annonces du même modèle`,
  ia: () => 'estimation IA',
  neuf: () => 'depuis le prix neuf (grossier)',
};

/**
 * Price and check of a listing, said once: the gap to its market with its source, why the check
 * says what it says, the seller, then the detail of every source on demand.
 */
export function Benchmarks({
  ad,
  estimate,
  category,
  busy,
  locked,
  onCheck,
  onCheckSeller,
}: {
  ad: StoredAd;
  /** Market reference of the listing (best source available). */
  estimate: Estimate | null;
  category: number;
  /** Current step while this listing is being checked. */
  busy: string | null;
  /** Another check is running. */
  locked: boolean;
  onCheck: (query: Search) => void;
  onCheckSeller: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const c = ad.comparison;
  const v = ad.verification;
  const sc = ad.sellerCheck;
  const price = ad.price;
  const mileage = numberFrom(ad.attributes.mileage);
  const year = numberFrom(ad.attributes.regdate);
  const drop = ad.firstPrice != null && price != null && ad.firstPrice > price ? ad.firstPrice - price : 0;
  const ai = ad.analysis?.market_price ?? null;
  // Comparisons saved before required_groups existed lack it.
  const query = c?.query ? { ...c.query, required_groups: c.query.required_groups ?? [] } : comparableQuery(ad, category);
  const motor = c?.match === 'motorisation' ? ' même moteur' : '';
  const striking = (estimate?.discount ?? 0) >= SELLER_CHECK_DISCOUNT;

  return (
    <aside className="bench" aria-label="Prix et vérification">
      <div className="row bench-head">
        <strong className="small">Prix</strong>
        <span className="spacer" />
        {!busy && (
          <button type="button" className="ghost small" disabled={locked} onClick={() => setEditing(!editing)} title="Régler la recherche de comparables">
            ⚙
          </button>
        )}
      </div>

      {estimate ? (
        <div className="has-tip" tabIndex={0}>
          {/* A big discount on a suspect listing is not good news: no green then. */}
          <div
            className={`target ${
              verdictOf(ad)?.verdict === 'suspect' ? 'warn-text' : estimate.discount >= 10 ? 'good' : estimate.discount < 0 ? 'bad' : ''
            }`}
          >
            {estimate.discount > 0 ? '−' : '+'}
            {Math.abs(estimate.discount)} %
            <span className="target-label"> {estimate.discount > 0 ? 'sous le marché' : 'au-dessus du marché'}</span>
          </div>
          <div className="small muted">
            {BASIS_LABEL[estimate.basis](estimate)}
            {estimate.basis === 'france' ? motor : ''}
            {estimate.basis === 'france' && v?.searchedAt ? ` · lues ${readAgo(v.searchedAt)}` : ''}
          </div>
          <span className="tip small" role="tooltip">
            {estimate.factors.map((f) => (
              <span key={f} className="tip-line">
                {f}
              </span>
            ))}
          </span>
        </div>
      ) : (
        <div className="small muted">Marché inconnu : lance l’analyse ou « Vérifier »</div>
      )}

      {busy ? (
        <div className="small muted">{busy}</div>
      ) : (
        v && (
          <div className="check-cause has-tip small" tabIndex={0}>
            Pourquoi : {v.cause}
            <span className="tip" role="tooltip">
              {v.detail.split('\n').filter(Boolean).map((line) => (
                <span key={line} className="tip-line">
                  • {line.replace(/^[-•]\s*/, '')}
                </span>
              ))}
            </span>
          </div>
        )
      )}

      {sc ? (
        <div className={`small has-tip seller seller-${sc.level}`} tabIndex={0}>
          {sc.level === 'ok' ? '✓' : '⚠'} Vendeur {sc.memberSince ? `depuis ${sc.memberSince}` : ''}
          {sc.totalAds != null ? ` · ${sc.totalAds} annonce${sc.totalAds > 1 ? 's' : ''}` : ''}{' '}
          <a href={sc.profileUrl} target="_blank" rel="noreferrer">
            profil ↗
          </a>
          <span className="tip" role="tooltip">
            {(sc.flags.length ? sc.flags : ['Rien d’anormal : compte ancien, pas de revente apparente']).map((f) => (
              <span key={f} className="tip-line">
                • {f}
              </span>
            ))}
            {sc.badges.length > 0 && <span className="tip-line">• {sc.badges.join(', ')}</span>}
          </span>
        </div>
      ) : (
        (striking || verdictOf(ad)?.verdict === 'suspect') &&
        !busy && <div className="small seller-attention">⚠ Vendeur non vérifié</div>
      )}

      {drop > 0 && <div className="small good">Baisse de {euro.format(drop)} depuis la 1re lecture</div>}

      {editing && !busy ? (
        <CompareForm
          initial={query}
          busy={false}
          onRun={(q) => {
            setEditing(false);
            onCheck(q);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        !busy && (
          <div className="row small bench-actions">
            {v ? (
              <button type="button" className="link small" disabled={locked} onClick={() => onCheck(query)}>
                Revérifier
              </button>
            ) : (
              <button type="button" className="primary small" disabled={locked || price == null} onClick={() => onCheck(query)}>
                Vérifier
              </button>
            )}
            {!sc && (
              <button type="button" className="link small" disabled={locked} onClick={onCheckSeller}>
                Vérifier le vendeur
              </button>
            )}
          </div>
        )
      )}

      {price != null && (c || ai != null || (estimate && estimate.basis !== 'france')) && !busy && (
        <details className="small check-market">
          <summary>Détail du prix</summary>
          <table className="sources">
            <tbody>
              {c && (
                <tr>
                  <th>France</th>
                  <td>
                    {euro.format(c.median)} <Diff price={price} value={c.median} />{' '}
                    <span className="muted">
                      ({c.count}
                      {motor})
                    </span>
                  </td>
                </tr>
              )}
              {estimate && (estimate.basis === 'annonces' || estimate.basis === 'neuf') && (
                <tr>
                  <th>Règles</th>
                  <td>
                    {euro.format(Math.round(estimate.expected / 50) * 50)} <Diff price={price} value={estimate.expected} />
                  </td>
                </tr>
              )}
              {ai != null && (
                <tr>
                  <th>IA</th>
                  <td>
                    {euro.format(ai)} <Diff price={price} value={ai} />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {c && (
            <>
              {c.adjustedTo && c.curve && (
                <div className="has-tip muted" tabIndex={0}>
                  Prix ramenés à{' '}
                  {[c.adjustedTo.year, c.adjustedTo.km != null ? `${int.format(c.adjustedTo.km)} km` : null].filter(Boolean).join(' et ')} ⓘ
                  <span className="tip" role="tooltip">
                    Chaque annonce comparée est corrigée de son écart d’année et de kilométrage avec celle-ci. Loi de décote :{' '}
                    {describeCurve(c.curve)}.
                  </span>
                </div>
              )}
              <Strip prices={c.prices} price={price} median={c.median} />
              <div className="muted">
                Habituel {euro.format(c.p25)}–{euro.format(c.p75)} · moins cher que {c.cheaperThan} %
              </div>
              {mileage != null && c.medianMileage != null && (
                <div className={mileage <= c.medianMileage ? 'good' : 'bad'}>
                  {int.format(mileage)} km vs {int.format(c.medianMileage)} km médian
                </div>
              )}
              {year != null && c.medianYear != null && year !== c.medianYear && (
                <div className={year > c.medianYear ? 'good' : 'bad'}>
                  {year} vs {c.medianYear} médian
                </div>
              )}
              <ul className="cheapest">
                {c.cheapest.map((x) => (
                  <li key={x.url}>
                    <a href={x.url} target="_blank" rel="noreferrer">
                      {euro.format(x.price)}
                    </a>
                    {x.adjusted != null && x.adjusted !== x.price && <span className="muted"> (≈ {euro.format(x.adjusted)} ajusté)</span>} ·{' '}
                    {x.year ?? '?'} · {x.mileage != null ? `${int.format(x.mileage)} km` : '?'} · {x.city ?? ''}
                  </li>
                ))}
              </ul>
              <a href={buildSearchUrl(c.query, null)} target="_blank" rel="noreferrer">
                Recherche nationale ↗
              </a>
            </>
          )}
        </details>
      )}
    </aside>
  );
}
