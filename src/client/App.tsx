import { useCallback, useEffect, useRef, useState } from 'react';
import { buildSearchUrl } from '../shared/leboncoin';
import type { Ad, Brief, Search, StoredAd } from '../shared/types';
import { extensionReady, fetchListings } from './extension';
import { ApiError, api, type BriefDetail } from './api';
import { addListingByUrl, checkSeller, strikingDeals } from './sellers';
import { AdList, isLbcPricey, isOffTopic, isRecent } from './components/AdList';
import { AdMap } from './components/AdMap';
import { HuntPanel } from './components/HuntPanel';
import { Login } from './components/Login';
import { NewBrief } from './components/NewBrief';
import { AnalysedCounter } from './components/AnalysedCounter';
import { askHome, useHome } from './home';

/** Home address for the Google Maps routes: shown in the top bar, click to change. */
function HomeButton() {
  const home = useHome();
  return (
    <button type="button" className="ghost home-button" onClick={() => askHome()} title="Adresse de départ des itinéraires Google Maps (gardée dans ce navigateur)">
      🏠 {home || 'Mon domicile'}
    </button>
  );
}

/** Share of the width given to the list (the map takes the rest), in %. */
const DEFAULT_LIST = 55;
const MIN_LIST = 35;
const MAX_LIST = 85;
const LIST_WIDTH_KEY = 'affaires.listWidth';

function readListWidth(): number {
  try {
    const v = Number(localStorage.getItem(LIST_WIDTH_KEY));
    return v >= MIN_LIST && v <= MAX_LIST ? v : DEFAULT_LIST;
  } catch {
    return DEFAULT_LIST;
  }
}

type Session = { state: 'loading' } | { state: 'out' } | { state: 'in'; mock: boolean; model: string };

export function App() {
  const [session, setSession] = useState<Session>({ state: 'loading' });
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<BriefDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState<{ id: string; step: string } | null>(null);
  /** Errors of a check, shown on the listing itself (the top banner is out of sight in the list). */
  const [adErrors, setAdErrors] = useState<Record<string, string>>({});
  const adError = (id: string, message: string | null) =>
    setAdErrors((all) => {
      const next = { ...all };
      if (message) next[id] = message;
      else delete next[id];
      return next;
    });
  /** Every listing by default (the age filter is there to narrow down). */
  const [maxAgeDays, setMaxAgeDays] = useState<number | null>(null);
  const [listWidth, setListWidth] = useState(readListWidth);
  const layoutRef = useRef<HTMLElement>(null);
  const saveListWidth = (value: number) => {
    const v = Math.min(MAX_LIST, Math.max(MIN_LIST, value));
    setListWidth(v);
    try {
      localStorage.setItem(LIST_WIDTH_KEY, String(Math.round(v * 10) / 10));
    } catch {
      /* private window: the width is just not remembered */
    }
  };
  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = layoutRef.current?.getBoundingClientRect();
    if (!box) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing');
    const move = (ev: PointerEvent) => saveListWidth(((ev.clientX - box.left) / box.width) * 100);
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      document.body.classList.remove('resizing');
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  };
  /** Listings off the shortlist are noise: hidden unless asked for. */
  const [showOffTopic, setShowOffTopic] = useState(false);
  /** Listings Leboncoin rates fair or pricier: hidden by default. */
  const [showLbcPricey, setShowLbcPricey] = useState(false);

  const checkSession = useCallback(async () => {
    try {
      const me = await api.me();
      setSession({ state: 'in', mock: me.mock, model: me.model });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setSession({ state: 'out' });
      else setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  const loadBriefs = useCallback(async () => {
    const list = await api.briefs();
    setBriefs(list);
    setSelectedId((current) => current ?? list[0]?.id ?? null);
    if (!list.length) setCreating(true);
  }, []);

  useEffect(() => {
    if (session.state === 'in') void loadBriefs().catch((e: Error) => setError(e.message));
  }, [session.state, loadBriefs]);

  const currentId = useRef<string | null>(null);
  currentId.current = selectedId;
  const reload = useCallback(async () => {
    if (!selectedId) return;
    const next = await api.brief(selectedId);
    // Ignore a late answer for a hunt that is no longer shown.
    if (currentId.current === selectedId) setDetail(next);
  }, [selectedId]);

  useEffect(() => {
    setDetail(null);
    void reload().catch((e: Error) => setError(e.message));
  }, [reload]);

  if (session.state === 'loading') return <div className="center muted">Chargement…</div>;
  if (session.state === 'out') return <Login onLoggedIn={checkSession} />;

  const toggleFlag = async (adId: string, flag: 'favorite' | 'hidden' | 'contacted', value: boolean) => {
    if (!detail) return;
    const patch = flag === 'contacted' ? { contactedAt: value ? new Date().toISOString() : null } : { [flag]: value };
    setDetail({ ...detail, ads: detail.ads.map((a) => (a.id === adId ? { ...a, ...patch } : a)) });
    try {
      await api.flagAd(detail.brief.id, adId, { [flag]: value });
    } catch (e) {
      setError((e as Error).message);
      void reload();
    }
  };

  /** National search for very similar listings, read through the extension, then placed by the server. */
  const categoryOf = (ad: StoredAd) =>
    detail?.plan?.plan.searches.find((s) => s.label === ad.searchLabel)?.category ?? 2;

  const checkSellerOf = async (adId: string) => {
    if (!detail || checking) return;
    const ad = detail.ads.find((a) => a.id === adId);
    if (!ad) return;
    adError(adId, null);
    setChecking({ id: adId, step: 'Profil du vendeur…' });
    try {
      await checkSeller(detail.brief.id, ad);
      await reload();
    } catch (e) {
      adError(adId, (e as Error).message);
    } finally {
      setChecking(null);
    }
  };

  /** A listing chosen by hand: read, added as a favourite, analysed, then shown. */
  const addListing = async (url: string) => {
    if (!detail) return;
    const briefId = detail.brief.id;
    const id = await addListingByUrl(briefId, url);
    await reload();
    for (let i = 0; i < 20; i++) {
      const r = await api.analyse(briefId);
      if (r.remaining === 0 || r.analysed === 0) break;
    }
    await reload();
    setHighlighted(id);
    setTimeout(() => document.getElementById(`ad-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
  };

  const checkAd = async (adId: string, query: Search) => {
    if (!detail || checking) return;
    const ad = detail.ads.find((a) => a.id === adId);
    if (!ad) return;
    adError(adId, null);
    try {
      // A striking deal: its seller is read first, the check takes it into account.
      if (!ad.sellerCheck && strikingDeals(detail.ads, detail.plan?.plan, detail.curves ?? {}).some((a) => a.id === ad.id)) {
        setChecking({ id: adId, step: 'Profil du vendeur…' });
        try {
          await checkSeller(detail.brief.id, ad);
        } catch (e) {
          adError(adId, `Vendeur : ${(e as Error).message}`);
        }
      }
      setChecking({ id: adId, step: 'Analyse…' });
      // One call when the server holds the national search (15 days); otherwise it says which pages
      // to read: the page only carries them (Leboncoin is read in this browser), the server decides.
      const first = await api.verify(detail.brief.id, ad.id, query);
      if ('needCandidates' in first) {
        setChecking({ id: adId, step: 'Annonces en France…' });
        if (!(await extensionReady())) throw new Error('Extension Affaires introuvable dans ce navigateur.');
        const candidates: Ad[] = [];
        for (const [i, url] of first.urls.entries()) {
          const result = await fetchListings(url);
          if (!result.ok) {
            if (result.reason === 'captcha') throw new Error('Leboncoin a demandé une vérification. Réessaie dans un moment.');
            break;
          }
          candidates.push(...result.ads);
          if (!result.ads.length || i === first.urls.length - 1) break;
          const [min, max] = first.pauseMs;
          await new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
        }
        setChecking({ id: adId, step: 'Analyse…' });
        await api.verify(detail.brief.id, ad.id, query, candidates);
      }
      await reload();
    } catch (e) {
      adError(adId, (e as Error).message);
    } finally {
      setChecking(null);
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Affaires</span>
        <select
          aria-label="Recherche en cours"
          value={selectedId ?? ''}
          onChange={(e) => {
            setCreating(false);
            setSelectedId(e.target.value);
          }}
        >
          {briefs.map((b) => (
            <option key={b.id} value={b.id}>
              {b.title}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => setCreating(true)}>
          Nouvelle recherche
        </button>
        {!creating && detail && detail.ads.length > 0 && <AnalysedCounter ads={detail.ads} />}
        <HomeButton />
        <span className="spacer" />
        {session.mock && <span className="pill warn">Mode démo (réponses d’exemple)</span>}
        <span className="muted small">{session.model}</span>
        <button
          type="button"
          className="ghost"
          onClick={async () => {
            await api.logout();
            setSession({ state: 'out' });
          }}
        >
          Déconnexion
        </button>
      </header>

      {error && (
        <div className="banner error" role="alert">
          {error}
          <button type="button" className="ghost" onClick={() => setError(null)}>
            Fermer
          </button>
        </div>
      )}

      {creating ? (
        <NewBrief
          onCancel={briefs.length ? () => setCreating(false) : undefined}
          onCreated={async (brief) => {
            setCreating(false);
            await loadBriefs();
            setSelectedId(brief.id);
          }}
          onError={setError}
        />
      ) : detail ? (
        <main className="layout" ref={layoutRef} style={{ ["--list" as string]: `${listWidth}%` }}>
          <section className="left">
            <HuntPanel
              detail={detail}
              onChanged={reload}
              onDeleted={async () => {
                setSelectedId(null);
                setDetail(null);
                await loadBriefs();
              }}
              onError={setError}
            />
            <AdList
              ads={detail.ads}
              highlighted={highlighted}
              onHover={setHighlighted}
              onToggle={toggleFlag}
              checking={checking}
              onCheck={checkAd}
              onCheckSeller={checkSellerOf}
              adErrors={adErrors}
              categoryOf={categoryOf}
              maxAgeDays={maxAgeDays}
              onMaxAgeDays={setMaxAgeDays}
              showOffTopic={showOffTopic}
              showLbcPricey={showLbcPricey}
              onShowLbcPricey={setShowLbcPricey}
              onShowOffTopic={setShowOffTopic}
              plan={detail.plan?.plan ?? null}
              curves={detail.curves ?? {}}
              lastCollectAt={detail.brief.lastCollectAt}
              onAddListing={addListing}
              onAsk={async (adId, question, history) => (await api.ask(detail.brief.id, adId, question, history)).answer}
            />
          </section>
          <div
            className="splitter"
            role="separator"
            aria-orientation="vertical"
            aria-label="Largeur de la liste"
            aria-valuemin={MIN_LIST}
            aria-valuemax={MAX_LIST}
            aria-valuenow={Math.round(listWidth)}
            tabIndex={0}
            title="Glisser pour régler la largeur de la liste (double-clic : par défaut)"
            onPointerDown={startResize}
            onDoubleClick={() => saveListWidth(DEFAULT_LIST)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') saveListWidth(listWidth - 2);
              if (e.key === 'ArrowRight') saveListWidth(listWidth + 2);
            }}
          />
          <aside className="right">
            <AdMap
              ads={detail.ads.filter(
                (a) => isRecent(a, maxAgeDays) && (showOffTopic || !isOffTopic(a) || a.favorite) && (showLbcPricey || !isLbcPricey(a) || a.favorite),
              )}
              highlighted={highlighted}
              onSelect={setHighlighted}
            />
          </aside>
        </main>
      ) : (
        <div className="center muted">Chargement…</div>
      )}
    </div>
  );
}
