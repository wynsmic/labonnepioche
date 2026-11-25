import type { ViewedAd } from '../../contracts/types';

/**
 * "Vendeur particulier" (or pro), then the profile check when done, otherwise a warning for the
 * deals that deserve one and a small button to check.
 */
export function SellerLine({
  ad,
  flagged,
  busy,
  locked,
  onCheck,
}: {
  ad: ViewedAd;
  /** Striking or suspect listing: an unchecked seller is worth a warning. */
  flagged: boolean;
  busy: boolean;
  locked: boolean;
  onCheck: () => void;
}) {
  const sc = ad.sellerCheck;
  const kind = ad.seller === 'pro' ? 'Vendeur pro' : 'Vendeur particulier';
  if (sc) {
    return (
      <span className={`seller-line has-tip seller-${sc.level}`} tabIndex={0}>
        {sc.level === 'ok' ? '✓' : '⚠'} {kind}
        <span className="seller-meta">
          {sc.memberSince ? ` · depuis ${sc.memberSince}` : ''}
          {sc.totalAds != null ? ` · ${sc.totalAds} annonce${sc.totalAds > 1 ? 's' : ''}` : ''}
        </span>{' '}
        <a href={sc.profileUrl} target="_blank" rel="noreferrer">
          profil ↗
        </a>
        <span className="tip" role="tooltip">
          {(sc.flags.length ? sc.flags : ['Rien d’anormal : compte ancien, pas de revente apparente']).map((f) => (
            <span key={f} className="tip-line">
              • {f}
            </span>
          ))}
          {sc.badges.length > 0 && <span className="tip-line">• {sc.badges.join(', ')}</span>}
        </span>
      </span>
    );
  }
  return (
    <span className="seller-line">
      <span className="seller-kind">{kind}</span>
      {flagged && (
        <span className="seller-attention" title="Annonce très sous le marché ou suspecte : vérifie le compte du vendeur">
          ⚠ non vérifié
        </span>
      )}
      <button type="button" className={`mini-action${busy ? ' is-loading' : ''}`} aria-busy={busy} disabled={locked} onClick={onCheck} title="Lire le profil du vendeur (ancienneté, autres annonces)">
        {busy ? 'Lecture…' : 'Vérifier'}
      </button>
    </span>
  );
}
