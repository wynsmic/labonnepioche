import { VERDICTS, verdictOf, type StoredAd, type Verdict } from '../../shared/types';
import { VERDICT_LABEL } from './AdList';

const ORDER: Verdict[] = ['pepite', 'bonne_affaire', 'correct', 'cher', 'suspect', 'hors_sujet'];

/**
 * Listings analysed for the current hunt, all versions together: the count, and a thin bar that is
 * both the progress (grey = waiting) and the split of verdicts.
 */
export function AnalysedCounter({ ads }: { ads: StoredAd[] }) {
  const counts = new Map<Verdict, number>(VERDICTS.map((v) => [v, 0]));
  for (const ad of ads) {
    const v = verdictOf(ad)?.verdict;
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const done = [...counts.values()].reduce((a, b) => a + b, 0);
  const total = ads.length;
  const waiting = total - done;
  const lines = ORDER.filter((v) => counts.get(v)).map((v) => `${counts.get(v)} ${VERDICT_LABEL[v].toLowerCase()}`);
  if (waiting) lines.push(`${waiting} en attente d’analyse`);
  return (
    <div
      className="counter"
      role="status"
      aria-label={`${done} annonces analysées sur ${total}`}
      title={`${done} annonces analysées sur ${total} pour cette recherche, toutes versions confondues\n${lines.join('\n')}`}
    >
      <span className="counter-text">
        <strong>{done === total ? total : `${done}/${total}`}</strong> analysées
      </span>
      <span className="counter-bar" aria-hidden>
        {ORDER.map((v) =>
          counts.get(v) ? <span key={v} className={`seg v-${v}`} style={{ flexGrow: counts.get(v) }} /> : null,
        )}
        {waiting > 0 && <span className="seg seg-wait" style={{ flexGrow: waiting }} />}
      </span>
    </div>
  );
}
