import { useMemo, useState } from 'react';
import type { Search, StoredAd, Verdict } from '../../shared/types';
import { Benchmarks } from './Benchmarks';
import { ageInDays } from '../../shared/compare';

export const VERDICT_LABEL: Record<Verdict, string> = {
  pepite: 'Pépite',
  bonne_affaire: 'Bonne affaire',
  correct: 'Correct',
  cher: 'Cher',
  suspect: 'Suspect',
  hors_sujet: 'Hors sujet',
};

type Sort = 'score' | 'price' | 'recent';

/** Listings with an unknown date stay visible. */
export function isRecent(ad: StoredAd, maxAgeDays: number | null): boolean {
  if (maxAgeDays == null) return true;
  const age = ageInDays(ad.date);
  return age == null || age <= maxAgeDays;
}

function ageLabel(date: string | null): string | null {
  const days = ageInDays(date);
  if (days == null) return null;
  if (days < 1) return `il y a ${Math.max(1, Math.round(days * 24))} h`;
  return `il y a ${Math.floor(days)} j`;
}

const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

/** Main characteristics shown under the title, in Leboncoin's order. */
function facts(ad: StoredAd): string {
  const a = ad.attributes;
  return [a.regdate, a.mileage ? `${a.mileage}`.replace(/km$/i, '').trim() + ' km' : null, a.fuel, a.gearbox]
    .filter(Boolean)
    .join(' · ');
}

export function AdList({
  ads,
  highlighted,
  onHover,
  onToggle,
  comparing,
  onCompare,
  categoryOf,
  maxAgeDays,
  onMaxAgeDays,
}: {
  ads: StoredAd[];
  highlighted: string | null;
  onHover: (id: string | null) => void;
  onToggle: (adId: string, flag: 'favorite' | 'hidden', value: boolean) => void;
  comparing: string | null;
  onCompare: (adId: string, query: Search) => void;
  categoryOf: (ad: StoredAd) => number;
  maxAgeDays: number | null;
  onMaxAgeDays: (days: number | null) => void;
}) {
  const [sort, setSort] = useState<Sort>('score');
  const [showHidden, setShowHidden] = useState(false);
  const [onlyFavorites, setOnlyFavorites] = useState(false);

  const shown = useMemo(() => {
    const list = ads.filter(
      (a) => (showHidden || !a.hidden) && (!onlyFavorites || a.favorite) && isRecent(a, maxAgeDays),
    );
    const byScore = (a: StoredAd) => a.analysis?.score ?? -1;
    return [...list].sort((a, b) =>
      sort === 'score'
        ? byScore(b) - byScore(a)
        : sort === 'price'
          ? (a.price ?? Infinity) - (b.price ?? Infinity)
          : (b.date ?? '').localeCompare(a.date ?? ''),
    );
  }, [ads, sort, showHidden, onlyFavorites, maxAgeDays]);
  const tooOld = ads.filter((a) => !a.hidden && !isRecent(a, maxAgeDays)).length;

  if (!ads.length) {
    return (
      <p className="muted empty">
        Aucune annonce pour l’instant. Prépare la recherche, puis récupère les annonces.
      </p>
    );
  }

  return (
    <section className="results" aria-label="Annonces">
      <div className="row filters small">
        <strong>{shown.length} annonces</strong>
        {tooOld > 0 && <span className="muted">({tooOld} plus anciennes)</span>}
        <span className="spacer" />
        <label>
          Publiées{' '}
          <select
            value={maxAgeDays ?? ''}
            onChange={(e) => onMaxAgeDays(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="1">depuis 24 h</option>
            <option value="3">depuis 3 j</option>
            <option value="7">depuis 7 j</option>
            <option value="30">depuis 30 j</option>
            <option value="">toutes</option>
          </select>
        </label>
        <label>
          Trier par{' '}
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="score">intérêt</option>
            <option value="price">prix</option>
            <option value="recent">date</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={onlyFavorites} onChange={(e) => setOnlyFavorites(e.target.checked)} />{' '}
          Favoris
        </label>
        <label>
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Masquées
        </label>
      </div>
      <ul className="ads">
        {shown.map((ad) => (
          <li
            key={ad.id}
            id={`ad-${ad.id}`}
            className={`ad${highlighted === ad.id ? ' highlighted' : ''}${ad.hidden ? ' is-hidden' : ''}`}
            onMouseEnter={() => onHover(ad.id)}
            onMouseLeave={() => onHover(null)}
          >
            <div className="ad-main">
            <a className="ad-link" href={ad.url} target="_blank" rel="noreferrer">
              <div className="thumb">
                {ad.image ? <img src={ad.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}
                {ad.seller === 'pro' && (
                  <span className="pro-badge" title="Annonce d’un professionnel">
                    PRO
                  </span>
                )}
              </div>
              <div className="ad-body">
                <div className="ad-title">{ad.title}</div>
                <div className="ad-price">{ad.price != null ? euro.format(ad.price) : 'Prix non indiqué'}</div>
                <div className="muted small">{facts(ad)}</div>
                <div className="muted small">
                  {[ad.city, ad.zipcode].filter(Boolean).join(' ')} · {ad.seller === 'pro' ? 'Pro' : 'Particulier'}
                  {ad.date ? (
                    <>
                      {' · '}
                      <span className={(ageInDays(ad.date) ?? 0) > 3 ? 'stale' : 'fresh'}>{ageLabel(ad.date)}</span>
                    </>
                  ) : null}
                </div>
                {ad.analysis && (
                  <>
                    <div className="verdict-row">
                      <span className={`verdict v-${ad.analysis.verdict}`}>{VERDICT_LABEL[ad.analysis.verdict]}</span>
                      <span className="score">{ad.analysis.score}/100</span>
                      {ad.analysis.market_price != null && (
                        <span className="muted small">marché ≈ {euro.format(ad.analysis.market_price)}</span>
                      )}
                    </div>
                    <p className="summary small">{ad.analysis.summary}</p>
                    {ad.analysis.red_flags.length > 0 && (
                      <p className="flags small">⚠ {ad.analysis.red_flags.join(' · ')}</p>
                    )}
                    {ad.analysis.questions.length > 0 && (
                      <p className="muted small">À demander : {ad.analysis.questions.join(' · ')}</p>
                    )}
                  </>
                )}
              </div>
            </a>
            <Benchmarks
              ad={ad}
              category={categoryOf(ad)}
              busy={comparing === ad.id}
              onCompare={(query) => onCompare(ad.id, query)}
            />
            </div>
            <div className="ad-actions">
              <label title="Favori">
                <input
                  type="checkbox"
                  checked={ad.favorite}
                  onChange={(e) => onToggle(ad.id, 'favorite', e.target.checked)}
                />{' '}
                ★ Favori
              </label>
              <label title="Masquer">
                <input
                  type="checkbox"
                  checked={ad.hidden}
                  onChange={(e) => onToggle(ad.id, 'hidden', e.target.checked)}
                />{' '}
                Masquer
              </label>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
