import type { LocationDevice } from "@/lib/location";

import type { Travel } from "./event-prep.ts";

// Working out a drive: where a named place is (OpenStreetMap's Nominatim) and
// how long the road there takes (the public OSRM router). Both are free,
// keyless services meant for light use, so answers are cached and requests
// are few: at most a handful per Today load. No live traffic.

const AGENT = "Vox personal assistant (https://vox-assistant.ericcheng306.workers.dev)";
const GEOCODE_TTL_SECONDS = 24 * 60 * 60;
const ROUTE_TTL_SECONDS = 20 * 60;
/** Further than this isn't a drive to plan a departure around. */
const MAX_TRIP_KM = 250;

export type Place = { label: string; lat: number; lon: number };

async function cachedJson(url: string, ttlSeconds: number): Promise<unknown> {
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const key = new Request(url, { method: "GET" });
  try {
    const hit = await cache?.match(key);
    if (hit) return await hit.json();
  } catch {
    // No cache here: ask the service.
  }
  const response = await fetch(url, {
    headers: { "User-Agent": AGENT, "Accept-Language": "zh-TW,en" },
    signal: AbortSignal.timeout(6_000),
  });
  if (!response.ok) throw new Error(`Lookup returned ${response.status}`);
  const text = await response.text();
  try {
    await cache?.put(key, new Response(text, { headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${ttlSeconds}` } }));
  } catch {
    // Uncached is fine.
  }
  return JSON.parse(text);
}

export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Where the user most likely is: their phone if it reported recently, else any device. */
export function currentPlace(devices: LocationDevice[], now = Date.now(), maxAgeMs = 6 * 60 * 60_000): Place | null {
  const fresh = devices
    .filter((device) => device.last && now - Date.parse(device.last.capturedAt) <= maxAgeMs)
    .sort((a, b) => Number(b.kind === "iphone") - Number(a.kind === "iphone") || Date.parse(b.last!.capturedAt) - Date.parse(a.last!.capturedAt));
  const last = fresh[0]?.last;
  return last ? { label: last.place || fresh[0].name, lat: last.lat, lon: last.lon } : null;
}

/** A named place as coordinates, looking near `near` first. Null when it isn't found. */
export async function findPlace(name: string, near: Place | null): Promise<Place | null> {
  const query = name.replace(/\s+/g, " ").trim().slice(0, 200);
  if (query.length < 3) return null;
  const params = new URLSearchParams({ format: "jsonv2", limit: "1", q: query });
  if (near) {
    // Prefer matches within roughly 150 km of where the user is.
    params.set("viewbox", `${near.lon - 1.5},${near.lat + 1.5},${near.lon + 1.5},${near.lat - 1.5}`);
  }
  try {
    const results = (await cachedJson(`https://nominatim.openstreetmap.org/search?${params}`, GEOCODE_TTL_SECONDS)) as Array<{ lat?: string; lon?: string; display_name?: string }>;
    const first = Array.isArray(results) ? results[0] : null;
    const lat = Number(first?.lat);
    const lon = Number(first?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { label: query, lat, lon };
  } catch {
    return null;
  }
}

/** Driving minutes on clear roads. Null when no route is found or it's too far to be a drive. */
export async function driveMinutes(from: Place, to: Place): Promise<number | null> {
  if (distanceKm(from, to) > MAX_TRIP_KM) return null;
  // Rounded so nearby pings share a cached route.
  const point = (place: Place) => `${place.lon.toFixed(3)},${place.lat.toFixed(3)}`;
  try {
    const result = (await cachedJson(
      `https://router.project-osrm.org/route/v1/driving/${point(from)};${point(to)}?overview=false`,
      ROUTE_TTL_SECONDS,
    )) as { routes?: Array<{ duration?: number }> };
    const seconds = result.routes?.[0]?.duration;
    return typeof seconds === "number" && Number.isFinite(seconds) ? Math.max(1, Math.round(seconds / 60)) : null;
  } catch {
    return null;
  }
}

/** The drive from `from` to a named place, or null when either end can't be worked out. */
export async function planTravel(from: Place | null, destination: string): Promise<Travel | null> {
  if (!from) return null;
  const to = await findPlace(destination, from);
  if (!to) return null;
  const minutes = await driveMinutes(from, to);
  return minutes === null ? null : { minutes, from, to };
}
