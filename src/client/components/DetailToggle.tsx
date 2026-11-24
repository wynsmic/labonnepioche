/** Round chevron button that opens or closes a detail panel. */
export function DetailToggle({ open, onClick, label }: { open: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      className={`detail-toggle${open ? ' is-open' : ''}`}
      aria-expanded={open}
      aria-label={`${open ? 'Fermer' : 'Voir'} ${label}`}
      title={`${open ? 'Fermer' : 'Voir'} ${label}`}
      onClick={onClick}
    >
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
  );
}
