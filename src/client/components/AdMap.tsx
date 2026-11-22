import { useEffect, useMemo } from 'react';
import { CircleMarker, MapContainer, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet';
import type { LatLngBoundsExpression } from 'leaflet';
import { verdictOf, type StoredAd, type Verdict } from '../../shared/types';
import { VERDICT_LABEL } from './AdList';

/** Marker colours by verdict (the map tiles are always light). */
const VERDICT_COLOR: Record<Verdict | 'none', string> = {
  pepite: '#0b8a5b',
  bonne_affaire: '#3fae6a',
  correct: '#d9a400',
  cher: '#d9622b',
  suspect: '#b3261e',
  hors_sujet: '#8a8f98',
  none: '#5a7bd8',
};
const FAVORITE_RING = '#f2b600';

const FRANCE: LatLngBoundsExpression = [
  [42.3, -4.8],
  [51.1, 8.2],
];

function FitBounds({ ads, fitKey }: { ads: StoredAd[]; fitKey: string }) {
  const map = useMap();
  useEffect(() => {
    const points = ads.map((a) => [a.lat!, a.lng!] as [number, number]);
    if (points.length) map.fitBounds(points, { padding: [30, 30], maxZoom: 12 });
    else map.fitBounds(FRANCE);
    // Refit only when new listings arrive, not when one is hidden (keeps the user's zoom).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, map]);
  return null;
}

export function AdMap({
  ads,
  highlighted,
  onSelect,
}: {
  ads: StoredAd[];
  highlighted: string | null;
  onSelect: (id: string) => void;
}) {
  // Hidden listings leave the map.
  const located = useMemo(() => ads.filter((a) => !a.hidden && a.lat != null && a.lng != null), [ads]);
  const fitKey = useMemo(() => ads.map((a) => a.id).join(','), [ads]);

  return (
    <MapContainer className="map" bounds={FRANCE} scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds ads={located} fitKey={fitKey} />
      {located.map((ad) => {
        const active = ad.id === highlighted;
        const v = verdictOf(ad);
        const color = VERDICT_COLOR[v?.verdict ?? 'none'];
        return (
          <CircleMarker
            key={ad.id}
            center={[ad.lat!, ad.lng!]}
            radius={active ? 11 : ad.favorite ? 9 : 7}
            pathOptions={{
              color: ad.favorite ? FAVORITE_RING : '#ffffff',
              weight: ad.favorite || active ? 3 : 1,
              fillColor: color,
              fillOpacity: 0.9,
            }}
            eventHandlers={{
              click: () => {
                onSelect(ad.id);
                document.getElementById(`ad-${ad.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              },
            }}
          >
            <Tooltip>
              {ad.price != null ? `${ad.price.toLocaleString('fr-FR')} €` : ''} {ad.title}
            </Tooltip>
            <Popup>
              <strong>{ad.title}</strong>
              <br />
              {ad.price != null ? `${ad.price.toLocaleString('fr-FR')} €` : 'Prix non indiqué'}
              {v ? ` · ${VERDICT_LABEL[v.verdict]}${v.verified ? ' ✓' : ''} ${v.score}/100` : ''}
              <br />
              <a href={ad.url} target="_blank" rel="noreferrer">
                Voir sur Leboncoin ↗
              </a>
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
