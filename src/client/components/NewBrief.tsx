import { useState } from 'react';
import type { Brief } from '../../shared/types';
import { api } from '../api';

const EXAMPLE =
  'Je cherche une superbe affaire de voiture robuste et économique pour rouler 15 000 km/an, budget 9 000 € maximum, autour de Rennes. Boîte manuelle ou automatique, pas de diesel.';

export function NewBrief({
  onCreated,
  onCancel,
  onError,
}: {
  onCreated: (brief: Brief) => void;
  onCancel?: () => void;
  onError: (message: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [locationsUrl, setLocationsUrl] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="card new-brief"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          onCreated(await api.createBrief({ title, prompt, locationsUrl: locationsUrl || undefined }));
        } catch (err) {
          onError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>Nouvelle recherche</h2>
      <label htmlFor="nb-title">Nom</label>
      <input id="nb-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Voiture robuste" />
      <label htmlFor="nb-prompt">Ce que tu cherches</label>
      <textarea
        id="nb-prompt"
        rows={6}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={EXAMPLE}
      />
      <label htmlFor="nb-zone">Zone (facultatif)</label>
      <input
        id="nb-zone"
        value={locationsUrl}
        onChange={(e) => setLocationsUrl(e.target.value)}
        placeholder="Colle l’URL d’une recherche Leboncoin réglée sur ta ville et ton rayon"
      />
      <p className="muted small">
        Sur Leboncoin, choisis ta ville et un rayon, lance une recherche, puis copie l’adresse de la page ici. Sans
        zone, la recherche couvre toute la France.
      </p>
      <div className="row">
        <button type="submit" className="primary" disabled={busy || !title || prompt.length < 3}>
          Créer
        </button>
        {onCancel && (
          <button type="button" className="ghost" onClick={onCancel}>
            Annuler
          </button>
        )}
      </div>
    </form>
  );
}
