import { useEffect, useRef, useState } from 'react';
import { buildSearchUrl } from '../../shared/leboncoin';
import type { Refine } from '../../shared/types';
import { api, type BriefDetail } from '../api';
import { extensionReady, fetchListings } from '../extension';

const PAGES_PER_SEARCH = 2;
/** Pause between two Leboncoin pages, like a person browsing. */
const PAUSE_MS: [number, number] = [4_000, 8_000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  const [prompt, setPrompt] = useState(brief.prompt);
  const [note, setNote] = useState('');
  const [zone, setZone] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [proposal, setProposal] = useState<Refine | null>(null);
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
    setProposal(null);
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
    <div className="card hunt">
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
              className="primary"
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
        <summary>Où : {brief.zone ?? 'toute la France'}</summary>
        <div className="row">
          <input
            aria-label="Villes de recherche"
            placeholder="Rennes 30 km, Saint-Malo, Vannes 20 km"
            value={zone}
            onChange={(e) => setZone(e.target.value)}
          />
          <button
            type="button"
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

      {/* 2. Steps */}
      <div className="steps">
        <button
          type="button"
          className="primary"
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
          className="primary"
          disabled={!!busy || !plan || selected.size === 0}
          onClick={() =>
            run('collect', async () => {
              if (!(await extensionReady())) {
                setExtOk(false);
                throw new Error('Extension Affaires introuvable dans ce navigateur (voir les instructions ci-dessous).');
              }
              const searches = plan!.plan.searches.filter((_, i) => selected.has(i));
              for (const search of searches) {
                for (let page = 1; page <= PAGES_PER_SEARCH; page++) {
                  if (!alive.current) return;
                  addLog(`Leboncoin : « ${search.label} », page ${page}…`);
                  const result = await fetchListings(buildSearchUrl(search, brief.locations, page));
                  if (!result.ok) {
                    if (result.reason === 'captcha') {
                      // Another search would hit the same check: stop the whole collection.
                      addLog('Leboncoin a demandé une vérification qui n’a pas été résolue. Réessaie dans un moment.');
                      await onChanged();
                      return;
                    }
                    addLog(`Échec (${result.reason}).`);
                    break;
                  }
                  if (result.source && !/searchData\.ads$/.test(result.source)) {
                    addLog(`Attention : liste lue « ${result.source} » parmi ${result.lists.join(', ')}.`);
                  }
                  const counts = await api.addAds(brief.id, search.label, result.ads);
                  addLog(
                    `${result.ads.length} lues : ${counts.added} nouvelles, ${counts.offTarget} hors critères, ${counts.excluded} exclues.`,
                  );
                  if (result.ads.length < 20) break; // last page
                  await sleep(PAUSE_MS[0] + Math.random() * (PAUSE_MS[1] - PAUSE_MS[0]));
                }
              }
              await onChanged();
            })
          }
        >
          {busy === 'collect' ? 'Lecture de Leboncoin…' : '2. Récupérer les annonces'}
        </button>
        <button
          type="button"
          className="primary"
          disabled={!!busy || pending === 0}
          onClick={() =>
            run('analyse', async () => {
              let remaining = pending;
              while (remaining > 0 && alive.current) {
                addLog(`L’IA analyse les annonces (${remaining} restantes)…`);
                const r = await api.analyse(brief.id);
                remaining = r.remaining;
                if (!alive.current) return;
                await onChanged();
              }
              addLog('Analyse terminée.');
            })
          }
        >
          {busy === 'analyse' ? 'Analyse…' : `3. Analyser${pending ? ` (${pending})` : ''}`}
        </button>
        <button
          type="button"
          disabled={!!busy || !plan || detail.ads.length === 0}
          title="Retire les annonces de professionnels et celles qui ne correspondent à aucune des recherches préparées (les favoris restent)"
          onClick={() =>
            run('clean', async () => {
              const r = await api.clean(brief.id);
              addLog(`${r.removed} annonces hors critères retirées.`);
              await onChanged();
            })
          }
        >
          Retirer les hors critères
        </button>
        <button
          type="button"
          disabled={!!busy || !detail.ads.some((a) => a.analysis)}
          title="Remet toutes les annonces dans la file d’analyse (après un changement de demande ou de règles)"
          onClick={() =>
            run('reset', async () => {
              if (!window.confirm('Réanalyser toutes les annonces ? Cela coûte de nouveau des appels à l’IA.')) return;
              await api.resetAnalyses(brief.id);
              await onChanged();
            })
          }
        >
          Tout réanalyser
        </button>
        <button
          type="button"
          disabled={!!busy || !detail.ads.some((a) => a.favorite || a.hidden)}
          title="L’IA relit tes favoris et tes annonces masquées pour préciser la demande"
          onClick={() =>
            run('refine', async () => {
              setProposal(await api.refine(brief.id));
            })
          }
        >
          {busy === 'refine' ? 'Réflexion…' : 'Affiner la demande'}
        </button>
      </div>

      {extOk === false && (
        <p className="note warn small">
          L’extension Chrome « Affaires » n’est pas détectée. Elle lit Leboncoin depuis ton navigateur : installe-la
          (dossier <code>extension</code>, voir le README), puis recharge cette page.
        </p>
      )}

      {proposal && (
        <div className="proposal">
          <strong>Proposition de l’IA</strong>
          <p className="muted small">{proposal.rationale}</p>
          <textarea
            aria-label="Demande proposée"
            rows={5}
            value={proposal.prompt}
            onChange={(e) => setProposal({ ...proposal, prompt: e.target.value })}
          />
          <div className="row">
            <button
              type="button"
              className="primary"
              onClick={() =>
                run('save', async () => {
                  await api.updateBrief(brief.id, { prompt: proposal.prompt, note: 'Affinée avec l’IA' });
                  setProposal(null);
                  await onChanged();
                })
              }
            >
              Adopter cette version
            </button>
            <button type="button" className="ghost" onClick={() => setProposal(null)}>
              Ignorer
            </button>
          </div>
        </div>
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
        <div className="shortlist">
          <strong>Seuls choix retenus</strong>
          <ul>
            {plan.plan.shortlist.map((p) => (
              <li key={p.name}>
                <strong>{p.name}</strong> · {p.versions.join(', ')} · {p.years}
                <span className="muted small"> — marché {p.fair_price}</span>
                <div className="muted small">{p.why}</div>
              </li>
            ))}
          </ul>
        </div>
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
    </div>
  );
}
