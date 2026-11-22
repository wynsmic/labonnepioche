import { useState } from 'react';
import { buildSearchUrl } from '../../shared/leboncoin';
import { comparableQuery, numberFrom } from '../../shared/compare';
import type { Search, StoredAd } from '../../shared/types';
import { VERDICT_LABEL } from './AdList';

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

/**
 * Check of a listing: national price comparison (same engine when possible), then the model's
 * second verdict in one word, its cause in a few words, the detail on hover.
 */
export function Benchmarks({
  ad,
  category,
  busy,
  locked,
  onCheck,
}: {
  ad: StoredAd;
  category: number;
  /** Current step while this listing is being checked. */
  busy: string | null;
  /** Another check is running. */
  locked: boolean;
  onCheck: (query: Search) => void;
}) {
  const [editing, setEditing] = useState(false);
  const c = ad.comparison;
  const v = ad.verification;
  const price = ad.price;
  const mileage = numberFrom(ad.attributes.mileage);
  const year = numberFrom(ad.attributes.regdate);
  const days = daysSince(ad.date);
  const drop = ad.firstPrice != null && price != null && ad.firstPrice > price ? ad.firstPrice - price : 0;
  const query = c?.query ?? comparableQuery(ad, category);

  return (
    <aside className="bench" aria-label="Vérification">
      <div className="row bench-head">
        <strong className="small">Vérification</strong>
        <span className="spacer" />
        {!busy && (
          <button type="button" className="ghost small" disabled={locked} onClick={() => setEditing(!editing)} title="Régler la recherche de comparables">
            ⚙
          </button>
        )}
      </div>

      {busy ? (
        <div className="small muted">{busy}</div>
      ) : v ? (
        <>
          <div className={`check-verdict v-text-${v.verdict}`}>{VERDICT_LABEL[v.verdict]}</div>
          <div className="check-cause small" tabIndex={0}>
            {v.cause}
            <span className="tip" role="tooltip">
              {v.detail}
            </span>
          </div>
          <div className="small muted">
            {v.comparables
              ? `${v.comparables} annonces comparées · ${v.match === 'motorisation' ? 'même motorisation' : 'même modèle'}`
              : 'Pas assez d’annonces comparables'}
          </div>
        </>
      ) : (
        !editing && (
          <button type="button" className="primary small" disabled={locked || price == null} onClick={() => onCheck(query)}>
            Vérifier
          </button>
        )
      )}

      {editing && !busy && (
        <CompareForm
          initial={query}
          busy={false}
          onRun={(q) => {
            setEditing(false);
            onCheck(q);
          }}
          onCancel={() => setEditing(false)}
        />
      )}

      {c && price != null && !busy && (
        <details className="small check-market">
          <summary>
            <span className={price < c.median ? 'good' : 'bad'}>
              {pct(price, c.median) > 0 ? '+' : ''}
              {pct(price, c.median)} %
            </span>{' '}
            vs médiane France
          </summary>
          <div>
            Moins cher que <strong>{c.cheaperThan} %</strong> des {c.count} annonces
            {c.engine ? ` (${c.engine})` : ''}
          </div>
          <Strip prices={c.prices} price={price} median={c.median} />
          <div className="muted">
            Médiane {euro.format(c.median)} · habituel {euro.format(c.p25)}–{euro.format(c.p75)}
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
                </a>{' '}
                · {x.year ?? '?'} · {x.mileage != null ? `${int.format(x.mileage)} km` : '?'} · {x.city ?? ''}
              </li>
            ))}
          </ul>
          <a href={buildSearchUrl(c.query, null)} target="_blank" rel="noreferrer">
            Recherche nationale ↗
          </a>
        </details>
      )}

      {v && !busy && (
        <button type="button" className="ghost small" disabled={locked} onClick={() => onCheck(query)}>
          Revérifier
        </button>
      )}

      {drop > 0 && <div className="small good">Baisse de {euro.format(drop)} depuis la 1re lecture</div>}
      {days != null && (
        <div className="small muted">
          En ligne depuis {days} j{days >= 30 ? ' : vendeur peut-être ouvert à la négociation' : ''}
        </div>
      )}
    </aside>
  );
}
