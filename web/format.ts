/** Days since a date (fractional), null when unknown. Display only: « il y a 3 h », age filter. */
export function ageInDays(date: string | null, now = Date.now()): number | null {
  if (!date) return null;
  const t = Date.parse(date.replace(' ', 'T'));
  return Number.isNaN(t) ? null : Math.max(0, (now - t) / 86_400_000);
}
