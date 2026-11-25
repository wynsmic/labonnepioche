import { useMemo, useRef, useState } from 'react';
import type { Search, Verdict, ViewedAd } from '../../contracts/types';
import { Benchmarks, PriceDetail } from './Benchmarks';
import { DetailToggle } from './DetailToggle';
import { ageInDays } from '../format';
import { SellerLine } from './SellerLine';
import { routeUrl, useHome } from '../home';
import { composeMessage } from '../extension';

export const VERDICT_LABEL: Record<Verdict, string> = {
  pepite: 'Pépite',
  bonne_affaire: 'Bonne affaire',
  correct: 'Correct',
  cher: 'Cher',
  suspect: 'Suspect',
  hors_sujet: 'Hors sujet',
};

type Sort = 'score' | 'discount' | 'price' | 'recent';

/** Listings with an unknown date stay visible. */
export function isRecent(ad: ViewedAd, maxAgeDays: number | null): boolean {
  if (maxAgeDays == null) return true;
  const age = ageInDays(ad.date);
  return age == null || age <= maxAgeDays;
}

const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

/** Copies a first message to the seller, adapted to the listing. */
/** The message icon stays blue this long after the seller was written to. */
const CONTACTED_DAYS = 15;

function CopyMessage({ ad, onContacted }: { ad: ViewedAd; onContacted: () => void }) {
  const [state, setState] = useState<'idle' | 'filled' | 'copied' | 'error'>('idle');
  const contacted = ad.contactedAt != null && Date.now() - Date.parse(ad.contactedAt) < CONTACTED_DAYS * 86_400_000;
  return (
    <span className="copy-msg">
      <button
        type="button"
        className={`icon-toggle msg-button${contacted ? ' is-contacted' : ''}`}
        title={`${contacted ? `Message préparé le ${new Date(ad.contactedAt!).toLocaleDateString('fr-FR')}. ` : ''}Écrire au vendeur : ouvre le formulaire de message de Leboncoin avec un premier message adapté à cette annonce (copié aussi)`}
        aria-label="Écrire au vendeur sur Leboncoin"
        onClick={async () => {
          const text = ad.view.message;
          onContacted();
          const url = `https://www.leboncoin.fr/reply/${ad.id}`;
          let copied = false;
          try {
            await navigator.clipboard.writeText(text);
            copied = true;
          } catch {
            /* the form may still be filled */
          }
          // The extension opens the form and types the message; without it, a plain tab (paste it).
          const filled = await composeMessage(url, text)
            .then((r) => r.ok && r.filled)
            .catch(() => {
              window.open(url, '_blank', 'noopener');
              return false;
            });
          setState(filled ? 'filled' : copied ? 'copied' : 'error');
          setTimeout(() => setState('idle'), 2_500);
        }}
      >
        <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m3.5 6.5 8.5 6.5 8.5-6.5" />
        </svg>
      </button>
      {state !== 'idle' && (
        <span className={`copy-toast${state === 'error' ? ' is-error' : ''}`} role="status">
          {state === 'filled' ? 'Message prêt sur Leboncoin ✓' : state === 'copied' ? 'Message copié : colle-le sur Leboncoin' : 'Copie impossible'}
        </span>
      )}
    </span>
  );
}

/** « + Ajouter une annonce » : any Leboncoin listing, from its link, through the same analysis. */
function AddListing({ onAdd }: { onAdd: (url: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) {
    return (
      <button type="button" className="add-listing" onClick={() => setOpen(true)} title="Ajouter une annonce Leboncoin de ton choix, à partir de son lien, et l’analyser">
        <span aria-hidden>＋</span> Ajouter une annonce
      </button>
    );
  }
  return (
    <form
      className="add-listing-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!url.trim() || busy) return;
        setBusy(true);
        setError(null);
        try {
          await onAdd(url.trim());
          setUrl('');
          setOpen(false);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <input
        type="url"
        autoFocus
        placeholder="https://www.leboncoin.fr/ad/voitures/…"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        aria-label="Lien de l’annonce Leboncoin"
        disabled={busy}
      />
      <button type="submit" className={`action primary-action${busy ? ' is-loading' : ''}`} disabled={busy || !url.trim()}>
        {busy ? 'Lecture et analyse…' : 'Analyser'}
      </button>
      {!busy && (
        <button type="button" className="icon-toggle" onClick={() => setOpen(false)} aria-label="Annuler" title="Annuler">
          ✕
        </button>
      )}
      {error && (
        <span className="small bench-error add-listing-error" role="alert">
          {error}
        </span>
      )}
    </form>
  );
}

/** Year, mileage, engine, gearbox under the photo, as a 2×2 grid of self-explanatory values. */
function Specs({ ad }: { ad: ViewedAd }) {
  const facts = ad.view.specs;
  if (!facts.length) return null;
  return (
    <ul className="specs">
      {facts.map((f) => (
        <li key={f.label} className="spec" title={f.label}>
          {f.value}
          {f.hint && <span className={`spec-hint${f.tone ? ` ${f.tone}` : ''}`}>{f.hint}</span>}
        </li>
      ))}
    </ul>
  );
}

/** The shortlist choice the listing belongs to: name and level, what it is about, key figures, the trim. */
function ModelInfo({ ad }: { ad: ViewedAd }) {
  const { trim, model } = ad.view;
  const card = model && (model.tagline || model.tags.length) ? model : null;
  if (!card && !trim) return null;
  return (
    <div className="model small">
      {card && (
        <>
          {card.tagline && <div className="model-tagline">{card.tagline}</div>}
          {!!card.tags?.length && (
            <ul className="model-tags">
              {card.tags.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}
        </>
      )}
      {trim && (
        <div className="model-trim">
          <span className="model-label">Finition</span> <strong>{trim.name}</strong>
          {trim.note && <span className="muted"> · {trim.note}</span>}
        </div>
      )}
    </div>
  );
}

const SCORE_HELP =
  'Score d’intérêt sur 100 donné par l’IA pour ta demande : prix face au marché (ajusté à l’année et au km), état et historique, version conforme aux choix retenus, signaux d’alerte. Plus il est haut, plus l’annonce vaut le déplacement.';

/** The AI verdict in one line: label, score, short comment, and the toggle of its detail. */
function VerdictFoot({ ad, open, onToggle }: { ad: ViewedAd; open: boolean; onToggle: () => void }) {
  const current = ad.view.verdict;
  const a = ad.analysis;
  if (!current || !a) return null;
  const v = ad.verification;
  const comment = v ? v.cause.charAt(0).toUpperCase() + v.cause.slice(1) : a.summary;
  return (
    <div className={`verdict-wrap${open ? ' is-open' : ''}`}>
      <div className="verdict-foot">
        <span className={`verdict v-${current.verdict}`}>
          {VERDICT_LABEL[current.verdict]}
          {current.verified ? ' ✓' : ''}
        </span>
        <span className="score" title={`${SCORE_HELP}${current.verified ? ' ✓ : recalculé après la vérification France.' : ''}`}>
          {current.score}
          <small>/100</small>
        </span>
        <span className="verdict-comment" title={comment}>
          {comment}
        </span>
        <DetailToggle open={open} onClick={onToggle} label="le détail du verdict" />
      </div>
    </div>
  );
}

/** Everything behind the verdict: score meaning, check detail, notes, the seller's text (selectable). */
/** Follow-up questions to the AI about this listing, at the foot of its detail; short answers. */
function AskBox({ ask }: { ask: (question: string, history: { q: string; a: string }[]) => Promise<string> }) {
  const [thread, setThread] = useState<{ q: string; a: string }[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="ask-box">
      {thread.map((t, i) => (
        <div key={i} className="ask-turn">
          <div className="ask-q">{t.q}</div>
          <div className="ask-a">{t.a}</div>
        </div>
      ))}
      <form
        className="ask-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const q = question.trim();
          if (q.length < 2 || busy) return;
          setBusy(true);
          setError(null);
          try {
            const a = await ask(q, thread.slice(-4));
            setThread((t) => [...t, { q, a }]);
            setQuestion('');
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Une question sur cette annonce ? (ex. ce moteur a-t-il des pannes connues ?)"
          aria-label="Question à l’IA sur cette annonce"
          maxLength={500}
          disabled={busy}
        />
        <button type="submit" className={`action${busy ? ' is-loading' : ''}`} disabled={busy || question.trim().length < 2}>
          {busy ? 'L’IA réfléchit…' : 'Demander'}
        </button>
      </form>
      {error && (
        <div className="small bench-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

function VerdictDetail({
  ad,
  onClose,
  ask,
}: {
  ad: ViewedAd;
  onClose: () => void;
  ask: (question: string, history: { q: string; a: string }[]) => Promise<string>;
}) {
  const current = ad.view.verdict;
  const a = ad.analysis;
  if (!current || !a) return null;
  const v = ad.verification;
  return (
    <section className="detail-panel small" aria-label="Détail du verdict" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <header className="detail-head">
        <span className={`verdict v-${current.verdict}`}>
          {VERDICT_LABEL[current.verdict]}
          {current.verified ? ' ✓' : ''}
        </span>
        <strong>{current.score}/100</strong>
        <span className="spacer" />
        <button type="button" className="icon-toggle" title="Fermer" aria-label="Fermer le détail du verdict" onClick={onClose}>
          ✕
        </button>
      </header>
      <p className="pop-score muted">
        {SCORE_HELP}
        {current.verified ? ' Recalculé après la vérification France.' : ''}
      </p>
      <p className="pop-summary">{a.summary}</p>
      <ul className="notes">
        {v?.detail
          .split('\n')
          .filter(Boolean)
          .map((line) => (
            <li key={`v${line}`} className="note-info">
              {line.replace(/^[-•]\s*/, '')}
            </li>
          ))}
        {a.positives.map((x) => (
          <li key={`p${x}`} className="note-plus">{x}</li>
        ))}
        {a.red_flags.map((x) => (
          <li key={`f${x}`} className="note-flag">{x}</li>
        ))}
        {a.questions.map((x) => (
          <li key={`q${x}`} className="note-ask">{x}</li>
        ))}
      </ul>
      {ad.body.trim() && (
        <>
          <div className="pop-title">Description du vendeur</div>
          <p className="pop-desc">{ad.body.trim()}</p>
        </>
      )}
      <AskBox ask={ask} />
    </section>
  );
}

export function AdList({
  ads,
  highlighted,
  onHover,
  onToggle,
  checking,
  onCheck,
  onCheckSeller,
  adErrors,
  maxAgeDays,
  onMaxAgeDays,
  showOffTopic,
  onShowOffTopic,
  showLbcPricey,
  onShowLbcPricey,
  onAddListing,
  onAsk,
}: {
  ads: ViewedAd[];
  highlighted: string | null;
  onHover: (id: string | null) => void;
  onToggle: (adId: string, flag: 'favorite' | 'hidden' | 'contacted', value: boolean) => void;
  checking: { id: string; step: string } | null;
  onCheck: (adId: string, query: Search) => void;
  onCheckSeller: (adId: string) => void;
  adErrors: Record<string, string>;
  maxAgeDays: number | null;
  onMaxAgeDays: (days: number | null) => void;
  showOffTopic: boolean;
  showLbcPricey: boolean;
  onShowLbcPricey: (show: boolean) => void;
  onShowOffTopic: (show: boolean) => void;
  onAddListing: (url: string) => Promise<void>;
  onAsk: (adId: string, question: string, history: { q: string; a: string }[]) => Promise<string>;
}) {
  // Publication date by default: unlike the score, an analysis does not move a listing.
  const [sort, setSortState] = useState<Sort>(() => {
    try {
      const saved = localStorage.getItem('affaires.sort');
      return saved === 'score' || saved === 'discount' || saved === 'price' || saved === 'recent' ? saved : 'recent';
    } catch {
      return 'recent';
    }
  });
  const setSort = (value: Sort) => {
    setSortState(value);
    try {
      localStorage.setItem('affaires.sort', value);
    } catch {
      /* private window: not remembered */
    }
  };
  /**
   * Order frozen between explicit re-sorts: a listing whose score or price gap changes (analysis
   * done under your eyes) keeps its place. Re-sorted only when the sort changes or listings come
   * and go (a collection).
   */
  const order = useRef<{ sort: Sort; ids: string; rank: Map<string, number> } | null>(null);
  const home = useHome();
  const [showHidden, setShowHidden] = useState(false);
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  /** Open detail panels, as "<id>:verdict" / "<id>:price". */
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const isOpen = (key: string) => opened.has(key);
  const toggleOpen = (key: string) =>
    setOpened((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const shown = useMemo(() => {
    const list = ads.filter(
      (a) =>
        (showHidden || !a.hidden) &&
        (!onlyFavorites || a.favorite) &&
        (showOffTopic || !a.view.offTopic || a.favorite) &&
        (showLbcPricey || !a.view.notADeal || a.favorite) &&
        isRecent(a, maxAgeDays),
    );
    const ids = ads.map((a) => a.id).sort().join(',');
    if (!order.current || order.current.sort !== sort || order.current.ids !== ids) {
      const byScore = (a: ViewedAd) => a.view.verdict?.score ?? -1;
      const sorted = [...ads].sort((a, b) =>
        sort === 'score'
          ? byScore(b) - byScore(a)
          : sort === 'discount'
            ? (b.view.estimate?.discount ?? -Infinity) - (a.view.estimate?.discount ?? -Infinity)
            : sort === 'price'
              ? (a.price ?? Infinity) - (b.price ?? Infinity)
              : (b.date ?? '').localeCompare(a.date ?? ''),
      );
      order.current = { sort, ids, rank: new Map(sorted.map((a, i) => [a.id, i])) };
    }
    const rank = order.current.rank;
    return [...list].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  }, [ads, sort, showHidden, onlyFavorites, maxAgeDays, showOffTopic, showLbcPricey]);
  const tooOld = ads.filter((a) => !a.hidden && !isRecent(a, maxAgeDays)).length;
  const offTopic = ads.filter((a) => !a.hidden && !a.favorite && a.view.offTopic).length;
  const lbcPricey = ads.filter((a) => !a.hidden && !a.favorite && !a.view.offTopic && a.view.notADeal).length;

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
        <AddListing onAdd={onAddListing} />
        {tooOld > 0 && (
          <button type="button" className="link small" onClick={() => onMaxAgeDays(null)}>
            {tooOld} plus anciennes cachées · tout voir
          </button>
        )}
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
            <option value="recent">date de publication</option>
            <option value="score">intérêt</option>
            <option value="discount">décote estimée</option>
            <option value="price">prix</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={onlyFavorites} onChange={(e) => setOnlyFavorites(e.target.checked)} />{' '}
          Favoris
        </label>
        <label>
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Masquées
        </label>
        <label title="Annonces hors des choix retenus (cachées par défaut)">
          <input type="checkbox" checked={showOffTopic} onChange={(e) => onShowOffTopic(e.target.checked)} /> Hors sujet
          {offTopic ? ` (${offTopic})` : ''}
        </label>
        <label title="Annonces que Leboncoin juge au prix équitable ou plus cher ; sans verdict Leboncoin, celles que notre analyse juge « correct » ou « cher » (cachées par défaut, sauf favoris)">
          <input type="checkbox" checked={showLbcPricey} onChange={(e) => onShowLbcPricey(e.target.checked)} /> Pas une affaire
          {lbcPricey ? ` (${lbcPricey})` : ''}
        </label>
      </div>
      <ul className="ads">
        {shown.map((ad) => {
          return (
          <li
            key={ad.id}
            id={`ad-${ad.id}`}
            className={`ad${highlighted === ad.id ? ' highlighted' : ''}${ad.hidden ? ' is-hidden' : ''}`}
            onMouseEnter={() => onHover(ad.id)}
            onMouseLeave={() => onHover(null)}
          >
            <div className="ad-main">
              <div className="ad-left">
                <div className="ad-link">
                  <div className="ad-media">
                    <a className="thumb" href={ad.url} target="_blank" rel="noreferrer" tabIndex={-1}>
                      {ad.image ? <img src={ad.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}
                      {ad.seller === 'pro' && (
                        <span className="pro-badge" title="Annonce d’un professionnel">
                          PRO
                        </span>
                      )}
                      {ad.view.isNew && (
                        <span className="new-badge" title="Nouvelle depuis le dernier « Récupérer les annonces »">
                          Nouveau
                        </span>
                      )}
                    </a>
                    <Specs ad={ad} />
                  </div>
                  <div className="ad-body">
                    <div className="ad-head">
                      {/* The shortlist choice names the car better than the seller's title (kept on hover). */}
                      <a className="ad-title" href={ad.url} target="_blank" rel="noreferrer" title={`Annonce : ${ad.title}`}>
                        {ad.view.model?.name ?? ad.title}
                      </a>
                      {(ad.city || ad.zipcode) && (
                        <a
                          className="ad-place"
                          href={routeUrl(home, ad)}
                          target="_blank"
                          rel="noreferrer"
                          title={home ? `Itinéraire depuis « ${home} » (Google Maps)` : 'Itinéraire Google Maps (indique ton domicile en haut pour partir de chez toi)'}
                        >
                          <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" />
                            <circle cx="12" cy="9.5" r="2.5" />
                          </svg>
                          <span className="ad-place-text">{[ad.city, ad.zipcode].filter(Boolean).join(' ')}</span>
                        </a>
                      )}
                    </div>
                    <div className="seller-actions">
                      <SellerLine
                        ad={ad}
                        flagged={ad.view.sellerFlag}
                        busy={checking?.id === ad.id && /vendeur/i.test(checking.step)}
                        locked={checking != null}
                        onCheck={() => onCheckSeller(ad.id)}
                      />
                      <CopyMessage ad={ad} onContacted={() => onToggle(ad.id, 'contacted', true)} />
                    </div>
                    <ModelInfo ad={ad} />
                  </div>
                </div>
              </div>
              <div className="ad-verdict">
                <VerdictFoot ad={ad} open={isOpen(`${ad.id}:verdict`)} onToggle={() => toggleOpen(`${ad.id}:verdict`)} />
              </div>
              <Benchmarks
                ad={ad}
                busy={checking?.id === ad.id ? checking.step : null}
                locked={checking != null}
                onCheck={(query) => onCheck(ad.id, query)}
                error={adErrors[ad.id] ?? null}
                onToggle={(flag, value) => onToggle(ad.id, flag, value)}
                detailOpen={isOpen(`${ad.id}:price`)}
                onToggleDetail={() => toggleOpen(`${ad.id}:price`)}
              />
              {(isOpen(`${ad.id}:verdict`) || isOpen(`${ad.id}:price`)) && (
                <div className="ad-details">
                  {isOpen(`${ad.id}:verdict`) && (
                    <VerdictDetail ad={ad} onClose={() => toggleOpen(`${ad.id}:verdict`)} ask={(q, history) => onAsk(ad.id, q, history)} />
                  )}
                  {isOpen(`${ad.id}:price`) && (
                    <PriceDetail
                      ad={ad}
                            busy={checking?.id === ad.id ? checking.step : null}
                      locked={checking != null}
                      onCheck={(query) => onCheck(ad.id, query)}
                      onClose={() => toggleOpen(`${ad.id}:price`)}
                    />
                  )}
                </div>
              )}
            </div>
          </li>
          );
        })}
      </ul>
    </section>
  );
}
