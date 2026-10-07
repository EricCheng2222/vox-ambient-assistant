import type { LocationDevice } from "@/lib/location";

// What Vox may say on a phone call about where the owner's iPhone is: the
// place name and how long ago. Never coordinates, accuracy, or battery.

/** "5 minutes ago", phrased for saying on a call. */
function spokenAge(iso: string, now: number) {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export function iPhoneLocationForCallers(devices: LocationDevice[], now = Date.now()) {
  const phones = devices.filter((device) => device.kind === "iphone" && device.last);
  const latest = phones.sort((a, b) => Date.parse(b.last!.capturedAt) - Date.parse(a.last!.capturedAt))[0];
  if (!latest?.last) {
    return "No recent location for the iPhone is available. Say you can't tell where it is right now.";
  }
  const age = spokenAge(latest.last.capturedAt, now);
  const stale = now - Date.parse(latest.last.capturedAt) > 6 * 60 * 60_000;
  const place = latest.last.place
    ? `near ${latest.last.place}`
    : "at a place Vox has no name for (don't give coordinates)";
  return `The iPhone was last seen ${place}, ${age}.${stale ? " That's a while ago, so say it may have moved since." : ""}`;
}
