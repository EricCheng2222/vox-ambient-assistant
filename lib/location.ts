// Device locations: shared types and validation for pings and the map.

export type DeviceKind = "iphone" | "ipad" | "mac" | "browser" | "other";

export type DevicePosition = {
  lat: number;
  lon: number;
  /** Meters. */
  accuracy: number;
  capturedAt: string;
  /** A short place name the device looked up itself, when it could. */
  place: string | null;
  battery: number | null;
};

export type LocationDevice = {
  id: string;
  name: string;
  kind: DeviceKind;
  createdAt: string;
  lastSeenAt: string | null;
  last: DevicePosition | null;
};

const KINDS = new Set<DeviceKind>(["iphone", "ipad", "mac", "browser", "other"]);

export function parseDeviceKind(value: unknown): DeviceKind {
  return typeof value === "string" && KINDS.has(value as DeviceKind) ? (value as DeviceKind) : "other";
}

export function cleanDeviceName(value: unknown) {
  const name = typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/gu, "").trim().slice(0, 60)
    : "";
  return name || "Device";
}

/** Validates a ping body from a device. Returns null when it isn't usable. */
export function parsePing(body: unknown, now = Date.now()): DevicePosition | null {
  if (!body || typeof body !== "object") return null;
  const raw = body as Record<string, unknown>;
  const lat = Number(raw.lat);
  const lon = Number(raw.lon);
  const accuracy = Number(raw.accuracy);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) return null;
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100_000) return null;
  const captured = typeof raw.capturedAt === "string" ? Date.parse(raw.capturedAt) : Number.NaN;
  // A position from the future or from long ago is a broken clock, not a location.
  if (!Number.isFinite(captured) || captured > now + 5 * 60_000 || captured < now - 7 * 24 * 60 * 60_000) return null;
  const place = typeof raw.place === "string"
    ? raw.place.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 200) || null
    : null;
  const batteryValue = Number(raw.battery);
  const battery = raw.battery === null || raw.battery === undefined || !Number.isFinite(batteryValue)
    ? null
    : Math.min(1, Math.max(0, batteryValue));
  return {
    lat: Math.round(lat * 1e6) / 1e6,
    lon: Math.round(lon * 1e6) / 1e6,
    accuracy: Math.round(accuracy),
    capturedAt: new Date(captured).toISOString(),
    place,
    battery,
  };
}

/** "5 minutes ago", for Vox's spoken answer and the map. */
export function ageLabel(iso: string, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} days ago`;
}
