/** One place of the search area, as typed: "Rennes 30 km". */
export interface ZonePlace {
  name: string;
  radiusKm: number;
}

/** A place resolved to a French town (geo.api.gouv.fr). */
export interface ResolvedPlace extends ZonePlace {
  zip: string;
  lat: number;
  lng: number;
}

export const DEFAULT_RADIUS_KM = 30;

/** "Rennes 30 km, Saint-Malo; Vannes (20km)" -> places with a radius (30 km by default). */
export function parseZone(text: string): ZonePlace[] {
  return text
    .split(/[,;\n]|\s+et\s+/i)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const radius = part.match(/(\d{1,3})\s*km/i);
      const name = part
        .replace(/\(?\s*\d{1,3}\s*km\s*\)?/i, '')
        .replace(/\b(autour de|près de|vers|à)\b/gi, '')
        .trim();
      return { name, radiusKm: radius ? Math.min(Number(radius[1]), 200) : DEFAULT_RADIUS_KM };
    })
    .filter((p) => p.name.length > 1);
}

/** Leboncoin `locations` parameter: Town_Zip__lat_lng_radius_radius, comma-separated (radius in metres). */
export function toLocationsParam(places: ResolvedPlace[]): string {
  return places
    .map((p) => {
      const m = Math.round(p.radiusKm * 1000);
      return `${p.name.replace(/\s+/g, '-')}_${p.zip}__${p.lat}_${p.lng}_${m}_${m}`;
    })
    .join(',');
}
