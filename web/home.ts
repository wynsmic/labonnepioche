import { useSyncExternalStore } from 'react';

/** The user's home address, start of every Google Maps route (kept in this browser only). */
const KEY = 'affaires.home';
const listeners = new Set<() => void>();

export function getHome(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function setHome(value: string): void {
  try {
    if (value.trim()) localStorage.setItem(KEY, value.trim());
    else localStorage.removeItem(KEY);
  } catch {
    /* private window: not remembered */
  }
  listeners.forEach((l) => l());
}

export function useHome(): string {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getHome,
    () => '',
  );
}

/** Asks for the home address (prefilled); returns it, or null when cancelled. */
export function askHome(): string | null {
  const value = window.prompt('Ton adresse de départ pour les itinéraires (domicile) :', getHome());
  if (value == null) return null;
  setHome(value);
  return value.trim();
}

/**
 * Google Maps route from home to the listing (car). Without a home address, Google Maps starts
 * from the device's position.
 */
export function routeUrl(home: string, to: { lat: number | null; lng: number | null; city: string | null; zipcode: string | null }): string {
  const destination = to.lat != null && to.lng != null ? `${to.lat},${to.lng}` : [to.zipcode, to.city, 'France'].filter(Boolean).join(' ');
  const params = new URLSearchParams({ api: '1', destination, travelmode: 'driving' });
  if (home) params.set('origin', home);
  return `https://www.google.com/maps/dir/?${params}`;
}
