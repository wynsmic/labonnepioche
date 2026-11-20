import type { ResolvedPlace, ZonePlace } from '../shared/zone';

interface Commune {
  nom: string;
  codesPostaux: string[];
  centre?: { coordinates: [number, number] };
}

/** Finds each place among French towns (biggest match first). Unknown names come back in `missing`. */
export async function resolvePlaces(
  places: ZonePlace[],
): Promise<{ resolved: ResolvedPlace[]; missing: string[] }> {
  const results = await Promise.all(
    places.map(async (place) => {
      const url = new URL('https://geo.api.gouv.fr/communes');
      url.searchParams.set('nom', place.name);
      url.searchParams.set('fields', 'nom,codesPostaux,centre');
      url.searchParams.set('boost', 'population');
      url.searchParams.set('limit', '1');
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`Géocodage indisponible (${res.status})`);
      const [commune] = (await res.json()) as Commune[];
      if (!commune?.centre || !commune.codesPostaux.length) return { place, found: null };
      const [lng, lat] = commune.centre.coordinates;
      return {
        place,
        found: { name: commune.nom, zip: commune.codesPostaux[0], lat, lng, radiusKm: place.radiusKm },
      };
    }),
  );
  return {
    resolved: results.flatMap((r) => (r.found ? [r.found] : [])),
    missing: results.filter((r) => !r.found).map((r) => r.place.name),
  };
}
