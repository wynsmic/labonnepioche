import { useState } from 'react';
import type { Estimate, Search, ViewedAd } from '../../contracts/types';
import { ageInDays } from '../format';
import { DetailToggle } from './DetailToggle';

const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const int = new Intl.NumberFormat('fr-FR');

function pct(value: number, reference: number): number {
  return Math.round(((value - reference) / reference) * 100);
}

/** "il y a 3 h" / "il y a 2 j" for the listing's publication. */
function publishedAgo(date: string): string {
  const days = ageInDays(date) ?? 0;
  return days < 1 ? `il y a ${Math.max(1, Math.round(days * 24))} h` : `il y a ${Math.floor(days)} j`;
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

/** Leboncoin's own price verdict and range, as shown on the listing, for comparison. */
function LbcVerdict({ attributes }: { attributes: Record<string, string> }) {
  const label = attributes.car_price_positioning;
  const min = Number(attributes.car_price_min) || null;
  const max = Number(attributes.car_price_max) || null;
  if (!label && !(min && max)) return null;
  const tone = /tr[eè]s bonne|bonne affaire/i.test(label ?? '')
    ? 'good'
    : /l[eé]g[eè]rement/i.test(label ?? '')
      ? 'meh'
      : /au-dessus/i.test(label ?? '')
        ? 'bad'
        : /indisponible/i.test(label ?? '')
          ? 'none'
          : 'fair';
  return (
    <div className={`lbc-verdict lbc-${tone}`} title="Verdict de prix affiché par Leboncoin sur l’annonce, avec sa fourchette d’estimation">
      <span className="lbc-badge" aria-label="Leboncoin">
        lbc
      </span>
      <span className="lbc-label">{label ?? 'Estimation'}</span>
      {min && max && (
        <span className="lbc-range">
          {euro.format(min)} – {euro.format(max)}
        </span>
      )}
    </div>
  );
}

/** Colour of the price gap. A big discount on a suspect listing is not good news: no green then. */

/** The reference recalled next to the gap ("(42)") and its one-line explanation. */
const REFERENCE: Record<Estimate['basis'], (e: Estimate) => { short: string; tip: string }> = {
  marche: (e) => ({
    short: `(${e.peers})`,
    tip: `Courbe de prix du modèle ajustée sur ${e.peers} annonces en France, à l’âge et au kilométrage de celle-ci, corrigée de ce que dit son texte`,
  }),
  local: (e) => ({
    short: `(~${e.peers})`,
    tip: `Niveau mesuré sur ${e.peers} annonces du modèle déjà collectées (ta zone), forme de courbe de l’IA : lance « Analyser le prix » pour le marché France`,
  }),
  ia: () => ({ short: '(IA)', tip: 'Courbe de prix pressentie par l’IA pour ce modèle : lance « Analyser le prix » pour la caler sur le marché France' }),
  annonce: () => ({ short: '(IA)', tip: 'Prix estimé par l’IA pour cette annonce, sans courbe du modèle : lance « Analyser le prix »' }),
};

const BASIS_LABEL: Record<Estimate['basis'], (e: Estimate) => string> = {
  marche: (e) => `Marché France · courbe sur ${e.peers} annonces`,
  local: (e) => `Annonces collectées · niveau sur ${e.peers} annonces`,
  ia: () => 'Courbe pressentie par l’IA (avant analyse France)',
  annonce: () => 'Estimation IA de l’annonce',
};

/**
 * Price and check of a listing, said once: the gap to its market with its source, why the check
 * says what it says, the seller, then the detail of every source on demand.
 */
export function Benchmarks({
  ad,
  busy,
  locked,
  onCheck,
  error,
  onToggle,
  detailOpen,
  onToggleDetail,
}: {
  ad: ViewedAd;
  /** Current step while this listing is being checked. */
  busy: string | null;
  /** Another check is running. */
  locked: boolean;
  onCheck: (query: Search) => void;
  /** Why the last check of this listing failed. */
  error: string | null;
  onToggle: (flag: 'favorite' | 'hidden', value: boolean) => void;
  detailOpen: boolean;
  onToggleDetail: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const c = ad.comparison;
  const v = ad.verification;
  const price = ad.price;
  const { estimate, year, mileage, compareQuery: query } = ad.view;
  const drop = ad.firstPrice != null && price != null && ad.firstPrice > price ? ad.firstPrice - price : 0;
  const ai = ad.analysis?.market_price ?? null;
  const motor = c?.match === 'motorisation' ? ' même moteur' : '';

  // A big discount on a suspect listing is not good news: no green then.
  const tone = `tone-${ad.view.tone}`;
  const reference = estimate ? REFERENCE[estimate.basis](estimate) : null;
  const hasDetail = price != null && (estimate != null || c != null || ai != null);

  const settings = (
    <button
      type="button"
      className="icon-toggle"
      disabled={locked}
      onClick={() => setEditing(!editing)}
      title="Régler la recherche de comparables (mots-clés, années, km) avant de vérifier"
      aria-label="Régler la recherche de comparables"
      aria-expanded={editing}
    >
      ⚙
    </button>
  );
  const form = editing && !busy && (
    <CompareForm
      initial={query}
      busy={false}
      onRun={(q) => {
        setEditing(false);
        onCheck(q);
      }}
      onCancel={() => setEditing(false)}
    />
  );

  return (
    <>
      <aside className="bench" aria-label="Prix">
        <div className="bench-head">
          {ad.date ? (
            <span className={`bench-date ${(ageInDays(ad.date) ?? 0) > 3 ? 'stale' : 'fresh'}`} title={new Date(ad.date).toLocaleString('fr-FR')}>
              Publiée {publishedAgo(ad.date)}
            </span>
          ) : (
            <span className="bench-date muted">Date inconnue</span>
          )}
          <span className="spacer" />
          <button
            type="button"
            className={`icon-toggle${ad.favorite ? ' on fav' : ''}`}
            aria-pressed={ad.favorite}
            title={ad.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
            onClick={() => onToggle('favorite', !ad.favorite)}
          >
            {ad.favorite ? '★' : '☆'}
          </button>
          <button
            type="button"
            className={`icon-toggle${ad.hidden ? ' on' : ''}`}
            aria-pressed={ad.hidden}
            title={ad.hidden ? 'Réafficher l’annonce' : 'Masquer l’annonce'}
            onClick={() => onToggle('hidden', !ad.hidden)}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
              <circle cx="12" cy="12" r="3" />
              {!ad.hidden && <path d="M4 20 20 4" />}
            </svg>
          </button>
        </div>

        <div className="bench-price">{price != null ? euro.format(price) : 'Prix non indiqué'}</div>
        {drop > 0 && <div className="bench-drop">↓ {euro.format(drop)} depuis la 1re lecture</div>}
        <LbcVerdict attributes={ad.attributes} />

        {error && !busy && (
          <div className="small bench-error" role="alert">
            {error}
          </div>
        )}
        {busy && (
          <div className="bench-cta">
            <button type="button" className="action primary-action is-loading" aria-busy disabled>
              {busy}
            </button>
          </div>
        )}

        {/* Right under the price: the analysis as the next step, or to run again once done. */}
        {!busy && (
          <div className="bench-cta">
            {v ? (
              <button type="button" className="action" disabled={locked} onClick={() => onCheck(query)} title="Relire les annonces comparables et refaire l’analyse du prix">
                ↻ Réanalyser le prix
              </button>
            ) : (
              <button type="button" className="action primary-action" disabled={locked || price == null} onClick={() => onCheck(query)}>
                Analyser le prix
              </button>
            )}
            {settings}
          </div>
        )}
        {form}
      </aside>

      <div className="bench-foot">
        <div className={`verdict-wrap price-wrap${detailOpen ? ' is-open' : ''}`}>
          <div className="verdict-foot">
            {estimate ? (
              <>
                <span className={`gap-badge ${tone}`}>
                  {estimate.discount > 0 ? '−' : '+'}
                  {Math.abs(estimate.discount)} %
                </span>
                <span className="verdict-comment">
                  vs marché{' '}
                  <span className="peers" title={reference!.tip}>
                    {reference!.short}
                  </span>
                </span>
              </>
            ) : (
              <span className="verdict-comment muted">Marché inconnu</span>
            )}
            {hasDetail && <DetailToggle open={detailOpen} onClick={onToggleDetail} label="le calcul du prix" />}
          </div>

        </div>
      </div>
    </>
  );
}

/** How the price gap was reached: reference, sources, comparables; re-check from here. */
export function PriceDetail({
  ad,
  busy,
  locked,
  onCheck,
  onClose,
}: {
  ad: ViewedAd;
  busy: string | null;
  locked: boolean;
  onCheck: (query: Search) => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const c = ad.comparison;
  const v = ad.verification;
  const price = ad.price;
  const { estimate, year, mileage, compareQuery: query } = ad.view;
  const ai = ad.analysis?.market_price ?? null;
  const motor = c?.match === 'motorisation' ? ' même moteur' : '';
  const settings = (
    <button
      type="button"
      className="icon-toggle"
      disabled={locked}
      onClick={() => setEditing(!editing)}
      title="Régler la recherche de comparables (mots-clés, années, km) avant de vérifier"
      aria-label="Régler la recherche de comparables"
      aria-expanded={editing}
    >
      ⚙
    </button>
  );
  const form = editing && !busy && (
    <CompareForm
      initial={query}
      busy={false}
      onRun={(q) => {
        setEditing(false);
        onCheck(q);
      }}
      onCancel={() => setEditing(false)}
    />
  );
  return (
    <section className="detail-panel small" aria-label="Calcul du prix" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
              <header className="detail-head">
                {estimate && (
                  <span className={`gap-badge tone-${ad.view.tone}`}>
                    {estimate.discount > 0 ? '−' : '+'}
                    {Math.abs(estimate.discount)} %
                  </span>
                )}
                <strong>Calcul du prix</strong>
                <span className="spacer" />
                <button type="button" className="icon-toggle" title="Fermer" aria-label="Fermer le calcul du prix" onClick={onClose}>
                  ✕
                </button>
              </header>
              {estimate && (
                <>
                  <div className="pop-title">
                    {BASIS_LABEL[estimate.basis](estimate)}
                    {estimate.basis === 'marche' ? motor : ''}
                    {estimate.basis === 'marche' && v?.searchedAt ? ` · lues ${readAgo(v.searchedAt)}` : ''}
                  </div>
                  <ul className="notes">
                    {estimate.factors.map((f) => (
                      <li key={f} className="note-info">
                        {f}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <table className="sources">
                <tbody>
                  {estimate && (
                    <tr>
                      <th>Attendu</th>
                      <td>
                        {euro.format(Math.round(estimate.expected / 50) * 50)} <Diff price={price} value={estimate.expected} />{' '}
                        <span className="muted">
                          ({euro.format(Math.round(estimate.low / 50) * 50)} – {euro.format(Math.round(estimate.high / 50) * 50)})
                        </span>
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
              {c && price != null && (
                <>
                  {c.adjustedTo && c.curve && (
                    <div className="has-tip muted" tabIndex={0}>
                      Prix ramenés à{' '}
                      {[c.adjustedTo.year, c.adjustedTo.km != null ? `${int.format(c.adjustedTo.km)} km` : null].filter(Boolean).join(' et ')} ⓘ
                      <span className="tip" role="tooltip">
                        Chaque annonce comparée est ramenée à l’âge et au kilométrage de celle-ci le long de la courbe du modèle :{' '}
                        {ad.view.curveText}.
                      </span>
                    </div>
                  )}
                  <Strip prices={c.prices} price={price} median={c.median} />
                  <div className="muted">
                    Moitié du marché entre {euro.format(c.p25)} et {euro.format(c.p75)} pour un exemplaire courant · moins cher que {c.cheaperThan} % des annonces proches
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
                  {ad.view.nationalUrl && (
                    <a href={ad.view.nationalUrl} target="_blank" rel="noreferrer">
                      Recherche nationale ↗
                    </a>
                  )}
                </>
              )}
            </section>
  );
}
