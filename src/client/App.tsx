import { useCallback, useEffect, useRef, useState } from 'react';
import type { Brief } from '../shared/types';
import { ApiError, api, type BriefDetail } from './api';
import { AdList } from './components/AdList';
import { AdMap } from './components/AdMap';
import { HuntPanel } from './components/HuntPanel';
import { Login } from './components/Login';
import { NewBrief } from './components/NewBrief';

type Session = { state: 'loading' } | { state: 'out' } | { state: 'in'; mock: boolean; model: string };

export function App() {
  const [session, setSession] = useState<Session>({ state: 'loading' });
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<BriefDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const toggleFlag = async (adId: string, flag: 'favorite' | 'hidden', value: boolean) => {
    if (!detail) return;
    setDetail({ ...detail, ads: detail.ads.map((a) => (a.id === adId ? { ...a, [flag]: value } : a)) });
    try {
      await api.flagAd(detail.brief.id, adId, { [flag]: value });
    } catch (e) {
      setError((e as Error).message);
      void reload();
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
        <span className="spacer" />
        {session.mock && <span className="pill warn">Mode démo (sans Claude)</span>}
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
        <main className="layout">
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
            />
          </section>
          <aside className="right">
            <AdMap ads={detail.ads} highlighted={highlighted} onSelect={setHighlighted} />
          </aside>
        </main>
      ) : (
        <div className="center muted">Chargement…</div>
      )}
    </div>
  );
}
