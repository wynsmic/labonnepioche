import { useEffect, useRef, useState } from 'react';
import { buildSearchUrl } from '../../shared/leboncoin';
import { parseZone } from '../../shared/zone';
import { api, type BriefDetail } from '../api';
import { extensionReady, fetchListings } from '../extension';
import { checkStrikingSellers, readDetails } from '../sellers';

const PAGES_PER_SEARCH = 2;
/** Pause between two Leboncoin pages, like a person browsing. */
const PAUSE_MS: [number, number] = [4_000, 8_000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The area as actually searched: radius per town (Leboncoin's maximum is 200 km). */
function zoneLabel(zone: string | null): string {
  if (!zone) return 'toute la France';
  if (/^https?:/i.test(zone.trim())) return 'zone d’une recherche Leboncoin';
  const places = parseZone(zone);
  if (!places.length) return zone;
  return places
    .map((p) => `${p.name} ${p.radiusKm} km${/(\d{3,})\s*km/i.test(zone) && p.radiusKm === 200 ? ' (max.)' : ''}`)
    .join(', ');
}

/** When the listings were last fetched, short and relative: « il y a 3 h », « hier à 18:40 », « lun. 23/11 à 18:40 ». */
function lastFetch(at: string | null): { short: string; full: string } | null {
  if (!at) return null;
  // SQLite datetime('now'): UTC without a zone.
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(at) ? at : `${at.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return null;
  const min = Math.round((Date.now() - d.getTime()) / 60_000);
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const day = (x: Date) => x.toDateString();
  const yesterday = new Date(Date.now() - 86_400_000);
  const short =
    min < 1
      ? 'à l’instant'
      : min < 60
        ? `il y a ${min} min`
        : min < 6 * 60
          ? `il y a ${Math.round(min / 60)} h`
          : day(d) === day(new Date())
            ? `aujourd’hui à ${time}`
            : day(d) === day(yesterday)
              ? `hier à ${time}`
              : `${d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' })} à ${time}`;
  return { short, full: d.toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' }) };
}

/** ✕ next to a shortlist choice: removes the model (and its searches) from the hunt, after a confirm. */
function RemoveModel({ name, disabled, onRemove }: { name: string; disabled: boolean; onRemove: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={`remove-model${busy ? ' is-loading' : ''}`}
      title="Retirer ce modèle de la recherche"
      aria-label={`Retirer ${name} de la recherche`}
      disabled={disabled || busy}
      onClick={async () => {
        if (!window.confirm(`Retirer « ${name} » de la recherche ? Ses annonces déjà trouvées restent dans la liste.`)) return;
        setBusy(true);
        try {
          await onRemove();
        } catch (err) {
          window.alert((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? '' : '✕'}
    </button>
  );
}

/** « + Ajouter un modèle » : a model of the user's choice joins the hunt (the AI fills in versions, prices, search). */
function AddModel({ onAdd }: { onAdd: (name: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="add-model"
      onSubmit={async (e) => {
        e.preventDefault();
        if (name.trim().length < 2 || busy) return;
        setBusy(true);
        setError(null);
        try {
          await onAdd(name.trim());
          setName('');
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Ajouter un modèle (ex. Toyota C-HR hybride)"
        aria-label="Modèle à ajouter à la recherche"
        maxLength={120}
        disabled={busy}
      />
      <button type="submit" className={`action${busy ? ' is-loading' : ''}`} disabled={busy || name.trim().length < 2}>
        {busy ? 'L’IA prépare…' : '＋ Ajouter'}
      </button>
      {error && (
        <span className="small bench-error" role="alert">
          {error}
        </span>
      )}
    </form>
  );
}

export function HuntPanel({
  detail,
  onChanged,
  onDeleted,
  onError,
}: {
  detail: BriefDetail;
  onChanged: () => Promise<void>;
  onDeleted: () => void;
  onError: (message: string) => void;
}) {
  const { brief, plan, versions, pending } = detail;
  // Re-rendered each minute so « il y a 5 min » stays true.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  const fetched = lastFetch(brief.lastCollectAt);
  const [prompt, setPrompt] = useState(brief.prompt);
  const [note, setNote] = useState('');
  const [zone, setZone] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [extOk, setExtOk] = useState<boolean | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, [brief.id]);

  useEffect(() => {
    setPrompt(brief.prompt);
    setLog([]);
  }, [brief.id, brief.prompt]);

  useEffect(() => {
    setSelected(new Set(plan?.plan.searches.map((_, i) => i) ?? []));
    // Reset only when a new plan arrives, not on every reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.createdAt]);

  useEffect(() => {
    void extensionReady().then(setExtOk);
  }, []);

  const addLog = (line: string) => setLog((l) => [...l, line]);

  /** Analyses every listing still waiting, batch after batch. */
  async function analyseAll() {
    let first = true;
    for (;;) {
      if (!alive.current) return;
      const r = await api.analyse(brief.id);
      if (first && r.analysed === 0 && r.remaining === 0) return;
      first = false;
      await onChanged();
      if (r.remaining === 0 || r.analysed === 0) break;
      addLog(`L’IA analyse les annonces (${r.remaining} restantes)…`);
    }
    addLog('Analyse terminée.');
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const promptDirty = prompt !== brief.prompt;

  return (
    <>
    {/* The demand: title, text and its versions, area */}
    <section className="card demand" aria-label="Demande">
      <div className="row between">
        <h2>{brief.title}</h2>
        <button
          type="button"
          className="ghost small"
          onClick={() =>
            run('delete', async () => {
              if (!window.confirm(`Supprimer « ${brief.title} » et ses annonces ?`)) return;
              await api.deleteBrief(brief.id);
              onDeleted();
            })
          }
        >
          Supprimer
        </button>
      </div>

      {/* 1. The demand, versioned */}
      <label htmlFor="prompt">Ta demande</label>
      <textarea id="prompt" rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      <div className="row">
        {promptDirty && (
          <>
            <input
              aria-label="Note de version"
              placeholder="Ce qui change (facultatif)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button
              type="button"
              className={`primary${busy === 'save' ? ' is-loading' : ''}`}
              disabled={!!busy}
              onClick={() =>
                run('save', async () => {
                  await api.updateBrief(brief.id, { prompt, note: note || undefined });
                  setNote('');
                  await onChanged();
                })
              }
            >
              Enregistrer la version
            </button>
          </>
        )}
        {versions.length > 1 && (
          <select
            aria-label="Versions précédentes"
            value=""
            onChange={(e) => {
              const v = versions.find((x) => x.id === e.target.value);
              if (v) setPrompt(v.prompt);
            }}
          >
            <option value="">{versions.length} versions…</option>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.createdAt.slice(0, 16)} {v.note ? `— ${v.note}` : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      <details className="zone">
        <summary>Où : {zoneLabel(brief.zone)}</summary>
        <div className="row">
          <input
            aria-label="Villes de recherche"
            placeholder="Rennes 30 km, Saint-Malo, Vannes 20 km"
            value={zone}
            onChange={(e) => setZone(e.target.value)}
          />
          <button
            type="button"
            className={busy === 'zone' ? 'is-loading' : undefined}
            disabled={!!busy}
            onClick={() =>
              run('zone', async () => {
                await api.updateBrief(brief.id, { zone });
                setZone('');
                await onChanged();
              })
            }
          >
            {zone ? 'Enregistrer' : 'Toute la France'}
          </button>
        </div>
      </details>
    </section>

    <section className="card hunt" aria-label="Recherche">
      {/* Steps */}
      <div className="steps">
        <button
          type="button"
          className={`primary${busy === 'plan' ? ' is-loading' : ''}`}
          aria-busy={busy === 'plan'}
          disabled={!!busy || promptDirty}
          title={promptDirty ? 'Enregistre d’abord la demande' : undefined}
          onClick={() =>
            run('plan', async () => {
              addLog('L’IA se renseigne et prépare les recherches…');
              await api.plan(brief.id);
              await onChanged();
              addLog('Recherches prêtes.');
            })
          }
        >
          {busy === 'plan' ? 'Recherche en cours…' : '1. Préparer la recherche'}
        </button>
        <button
          type="button"
          className={`primary${busy === 'collect' || busy === 'details' || busy === 'sellers' ? ' is-loading' : ''}`}
          aria-busy={busy === 'collect' || busy === 'details' || busy === 'sellers'}
          disabled={!!busy || !plan || selected.size === 0}
          onClick={() =>
            run('collect', async () => {
              if (!(await extensionReady())) {
                setExtOk(false);
                throw new Error('Extension Affaires introuvable dans ce navigateur (voir les instructions ci-dessous).');
              }
              const searches = plan!.plan.searches.filter((_, i) => selected.has(i));
              // The list becomes what Leboncoin shows now: at the end of a complete collection,
              // what was not read again goes (favourites stay; unchanged listings keep their analysis).
              let since: string | null = null;
              // One id per collection: the server dates the start of this run, listings seen first after it are "new".
              const collectRun = crypto.randomUUID();
              let complete = true;
              let read = 0;
              for (const search of searches) {
                for (let page = 1; page <= PAGES_PER_SEARCH; page++) {
                  if (!alive.current) return;
                  addLog(`Leboncoin : « ${search.label} », page ${page}…`);
                  const result = await fetchListings(buildSearchUrl(search, brief.locations, page));
                  if (!result.ok) {
                    if (result.reason === 'captcha') {
                      // Another search would hit the same check: stop the whole collection.
                      addLog('Leboncoin a demandé une vérification qui n’a pas été résolue. Liste gardée telle quelle ; réessaie dans un moment.');
                      await onChanged();
                      return;
                    }
                    addLog(`Échec (${result.reason}).`);
                    complete = false;
                    break;
                  }
                  if (result.source && !/searchData\.ads$/.test(result.source)) {
                    addLog(`Attention : liste lue « ${result.source} » parmi ${result.lists.join(', ')}.`);
                  }
                  const counts = await api.addAds(brief.id, search.label, result.ads, collectRun);
                  since ??= counts.seenAt;
                  read += result.ads.length;
                  addLog(
                    `${result.ads.length} lues : ${counts.added} nouvelles, ${counts.offTarget} hors critères, ${counts.excluded} exclues${counts.restored ? `, ${counts.restored} reprises du cache (15 j)` : ''}.`,
                  );
                  if (result.ads.length < 20) break; // last page
                  await sleep(PAUSE_MS[0] + Math.random() * (PAUSE_MS[1] - PAUSE_MS[0]));
                }
              }
              if (!alive.current) return;
              if (complete && since && read > 0) {
                const r = await api.prune(brief.id, since, searches.map((s) => s.label));
                if (r.removed) addLog(`${r.removed} anciennes annonces retirées (plus vues ou hors critères).`);
              } else if (!complete) {
                addLog('Collecte incomplète : les anciennes annonces sont gardées.');
              }
              await onChanged();
              // Search results carry no description: read each new listing's page (once, 15 days).
              setBusy('details');
              const details = await readDetails(brief.id, addLog, () => alive.current);
              if (details) addLog(`${details} textes d’annonces lus.`);
              await onChanged();
              if (!alive.current) return;
              // The flow ends on an analysed list.
              setBusy('analyse');
              addLog('L’IA analyse les nouvelles annonces…');
              await analyseAll();
              if (!alive.current) return;
              // Striking deals: is the seller a fresh account or a hidden business?
              setBusy('sellers');
              await checkStrikingSellers(brief.id, addLog);
              await onChanged();
            })
          }
        >
          <span>
            {busy === 'collect' ? 'Lecture de Leboncoin…' : busy === 'details' ? 'Lecture des annonces…' : busy === 'sellers' ? 'Vérification des vendeurs…' : '2. Récupérer les annonces'}
          </span>
          {fetched && (
            <span className="btn-sub" title={`Dernière pêche : ${fetched.full}`}>
              dernière pêche {fetched.short}
            </span>
          )}
        </button>
        <button
          type="button"
          className={`primary${busy === 'analyse' ? ' is-loading' : ''}`}
          aria-busy={busy === 'analyse'}
          disabled={!!busy || pending === 0}
          onClick={() =>
            run('analyse', async () => {
              // The analysis needs the sellers' texts: read the pages still unknown first.
              const details = await readDetails(brief.id, addLog, () => alive.current);
              if (details) {
                addLog(`${details} textes d’annonces lus.`);
                await onChanged();
              }
              addLog('L’IA analyse les annonces…');
              await analyseAll();
            })
          }
        >
          {busy === 'analyse' ? `Analyse…${pending ? ` (${pending} restantes)` : ''}` : `3. Analyser${pending ? ` (${pending})` : ''}`}
        </button>
      </div>

      {extOk === false && (
        <p className="note warn small">
          L’extension Chrome « Affaires » n’est pas détectée. Elle lit Leboncoin depuis ton navigateur : installe-la
          (dossier <code>extension</code>, voir le README), puis recharge cette page.
        </p>
      )}

      {log.length > 0 && (
        <ol className="log small" aria-live="polite">
          {log.slice(-12).map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ol>
      )}

      {/* 3. The plan: the shortlist first, it decides everything else */}
      {plan && (plan.plan.shortlist?.length ?? 0) > 0 && (
        <details className="shortlist">
          <summary>
            <strong>Choix retenus ({plan.plan.shortlist.length})</strong>
          </summary>
          <ul>
            {plan.plan.shortlist.map((p) => (
              <li key={p.name}>
                {p.tier && (
                  <span className={`tier ${p.tier}`}>{p.tier === 'excellent' ? 'Excellent' : 'Très bon'}</span>
                )}{' '}
                <strong>{p.name}</strong> · {p.versions.join(', ')} · {p.years}
                <RemoveModel
                  name={p.name}
                  disabled={!!busy || plan.plan.shortlist.length <= 1}
                  onRemove={async () => {
                    const r = await api.removeModel(brief.id, p.name);
                    // Search indexes shift down past each removed one.
                    setSelected((prev) => {
                      const next = new Set<number>();
                      for (const i of prev) if (!r.removed.includes(i)) next.add(i - r.removed.filter((j) => j < i).length);
                      return next;
                    });
                    addLog(`Modèle retiré : ${p.name}${r.removed.length ? ` (${r.removed.length} recherche${r.removed.length > 1 ? 's' : ''} en moins)` : ''}. Ses annonces déjà trouvées restent.`);
                    await onChanged();
                  }}
                />
                <span className="muted small"> — marché {p.fair_price}</span>
                <div className="muted small">{p.why}</div>
              </li>
            ))}
          </ul>
          <AddModel
            onAdd={async (name) => {
              const r = await api.addModel(brief.id, name);
              addLog(`Modèle ajouté : ${r.pick.name} (recherche « ${r.search.label} »). Lance « Récupérer » pour ses annonces.`);
              await onChanged();
              setSelected((prev) => new Set([...prev, r.index]));
            }}
          />
        </details>
      )}
      {plan && (
        <details className="plan" open={!detail.ads.length}>
          <summary>Détail de la recherche ({plan.plan.searches.length} recherches Leboncoin)</summary>
          <div className="research">{plan.plan.research}</div>
          <strong className="small">Critères</strong>
          <ul className="small">
            {plan.plan.criteria.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <ul className="searches">
            {plan.plan.searches.map((s, i) => (
              <li key={i}>
                <label className="row">
                  <input
                    type="checkbox"
                    checked={selected.has(i)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(i);
                      else next.delete(i);
                      setSelected(next);
                    }}
                  />
                  <span>
                    <strong>{s.label}</strong> <span className="muted small">— {s.why}</span>
                    {(s.required_groups?.length ?? 0) > 0 && (
                      <span className="small required">
                        {' '}
                        Doit contenir : {s.required_groups.map((g) => g.join(' / ')).join(' + ')}
                      </span>
                    )}
                  </span>
                </label>
                <a className="small" href={buildSearchUrl(s, brief.locations)} target="_blank" rel="noreferrer">
                  Ouvrir sur Leboncoin ↗
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
    </>
  );
}
