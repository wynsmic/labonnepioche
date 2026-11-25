import { useState } from 'react';
import { api } from '../api';

export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="login"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api.login(password);
          onLoggedIn();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h1>La Bonne Pioche</h1>
      <p className="muted">Les bonnes affaires Leboncoin, triées par l’IA.</p>
      <label htmlFor="password">Mot de passe</label>
      <input
        id="password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoFocus
      />
      {error && <p className="error-text">{error}</p>}
      <button type="submit" className={`primary${busy ? ' is-loading' : ''}`} aria-busy={busy} disabled={busy || !password}>
        {busy ? 'Connexion…' : 'Se connecter'}
      </button>
    </form>
  );
}
