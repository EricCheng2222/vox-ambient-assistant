"use client";

import { useCallback, useEffect, useState } from "react";
import { MapPin, Smartphone, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { DeviceMap, type MapPoint } from "@/components/device-map";
import { SettingsRow } from "@/components/settings-row";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ageLabel, type LocationDevice } from "@/lib/location";

type NativeSharing = {
  status: () => Promise<{ enabled: boolean; permission: string; deviceId: string | null; lastPingAt: string | null }>;
  enable: (request: { deviceId: string; token: string }) => Promise<{ enabled: boolean; permission: string; deviceId: string | null }>;
  disable: () => Promise<unknown>;
  pingNow: () => Promise<boolean>;
  /** Shows iOS's "Always" prompt if iOS still will (it only does once). */
  requestAlways?: () => Promise<{ enabled: boolean; permission: string; deviceId: string | null }>;
  /** Opens Vox's page in iOS Settings. */
  openSettings?: () => Promise<boolean>;
};

type NativeStatus = { enabled: boolean; permission: string; deviceId: string | null; lastPingAt?: string | null };

/**
 * Turns on location sharing for this iPhone: registers it with Vox, hands its
 * key to the app (which asks iOS for permission), and undoes the registration
 * if permission isn't given.
 */
export async function shareThisDevice(native: NativeSharing): Promise<NativeStatus> {
  const iPad = /iPad/i.test(navigator.userAgent);
  const response = await fetch("/api/locations/devices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: iPad ? "iPad" : "iPhone", kind: iPad ? "ipad" : "iphone" }),
  });
  const device = (await response.json().catch(() => ({}))) as { deviceId?: string; token?: string; error?: string };
  if (!response.ok || !device.deviceId || !device.token) throw new Error(device.error ?? "Couldn’t turn it on.");
  const status = await native.enable({ deviceId: device.deviceId, token: device.token });
  if (!status.enabled) {
    await fetch(`/api/locations/devices?id=${encodeURIComponent(device.deviceId)}`, { method: "DELETE" });
    throw new Error("Location permission is needed. Allow it in Settings → Vox → Location.");
  }
  return status;
}

/** The iPhone app's location sharing, when running inside it. */
export function nativeLocationSharing(): NativeSharing | null {
  if (typeof window === "undefined") return null;
  return (window as { voxNativeIOS?: { locationSharing?: NativeSharing } }).voxNativeIOS?.locationSharing ?? null;
}

/** Running inside the Vox iPhone/iPad app (which can share this device's location). */
export function isIPhoneApp() {
  return typeof window !== "undefined" && Boolean((window as { voxNativeIOS?: unknown }).voxNativeIOS);
}

export async function fetchDeviceLocations(): Promise<LocationDevice[]> {
  const response = await fetch("/api/locations", { cache: "no-store" });
  if (!response.ok) throw new Error("Locations are unavailable.");
  return ((await response.json()) as { devices?: LocationDevice[] }).devices ?? [];
}

export function devicePoints(devices: LocationDevice[], now = Date.now()): MapPoint[] {
  return devices.flatMap((device) =>
    device.last
      ? [{
          id: device.id,
          label: device.name,
          detail: [device.last.place, ageLabel(device.last.capturedAt, now)].filter(Boolean).join(" · "),
          lat: device.last.lat,
          lon: device.last.lon,
          accuracy: device.last.accuracy,
          stale: now - Date.parse(device.last.capturedAt) > 6 * 60 * 60_000,
        }]
      : [],
  );
}

/** Today: where each device last was. */
export function DeviceLocationsCard({ theme }: { theme: "dark" | "light" }) {
  const [devices, setDevices] = useState<LocationDevice[] | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetchDeviceLocations()
        .then((next) => {
          if (!cancelled) {
            setDevices(next);
            setNow(Date.now());
          }
        })
        .catch(() => undefined);
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (!devices || devices.length === 0) return null;
  const points = devicePoints(devices, now);
  return (
    <section className="vox-devices-card" aria-labelledby="devices-heading">
      <div className="vox-devices-head">
        <h2 id="devices-heading">Your devices</h2>
        <p>Last known locations</p>
      </div>
      {points.length > 0 ? <DeviceMap points={points} theme={theme} label="Where your devices last were" /> : null}
      <ul className="vox-devices-list">
        {devices.map((device) => (
          <li key={device.id}>
            <Smartphone aria-hidden="true" />
            <span className="vox-devices-name">{device.name}</span>
            <span className="vox-devices-detail">
              {device.last
                ? [device.last.place, ageLabel(device.last.capturedAt, now), device.last.battery !== null ? `${Math.round(device.last.battery * 100)}% battery` : ""].filter(Boolean).join(" · ")
                : "No location yet"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Settings → Devices → Location sharing. */
export function LocationSharingSettings() {
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState<LocationDevice[] | null>(null);
  const [native] = useState(() => nativeLocationSharing());
  const [nativeStatus, setNativeStatus] = useState<{ enabled: boolean; permission: string; deviceId: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setDevices(await fetchDeviceLocations().catch(() => []));
    if (native) setNativeStatus(await native.status().catch(() => null));
  }, [native]);

  useEffect(() => {
    if (open) queueMicrotask(() => void refresh());
  }, [open, refresh]);

  async function removeDevice(id: string) {
    setBusy(true);
    try {
      if (native && nativeStatus?.deviceId === id) await native.disable().catch(() => undefined);
      const response = await fetch(`/api/locations/devices?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok && response.status !== 404) throw new Error();
      toast.success("Removed. That device no longer shares its location.");
    } catch {
      toast.error("Couldn’t remove that device");
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  async function changeThisPhone(enabled: boolean) {
    if (!native) return;
    setBusy(true);
    try {
      if (enabled) {
        const status = await shareThisDevice(native);
        toast.success("Sharing this device’s location with Vox", {
          description: status.permission === "always"
            ? "It updates when you move, even when Vox is closed."
            : "It updates while Vox is open. Choose “Always” in Settings → Vox → Location to keep it current.",
        });
      } else if (nativeStatus?.deviceId) {
        await removeDevice(nativeStatus.deviceId);
        return;
      } else {
        await native.disable();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn’t change location sharing");
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <SettingsRow icon={<MapPin />} title="Location sharing" detail="Where your devices last were, on a map in Vox" />
      </SheetTrigger>
      <SheetContent className="w-[min(94vw,440px)] border-white/10 bg-[#10111b] text-white sm:max-w-[440px]">
        <SheetHeader className="border-b border-white/8 px-6 py-6 pr-12">
          <div className="flex items-center gap-2 text-[#78ebff]">
            <MapPin size={18} />
            <SheetTitle className="font-display text-xl text-white">Location sharing</SheetTitle>
          </div>
          <SheetDescription className="mt-2 leading-6 text-white/55">
            Devices you turn this on for report where they are, so Vox can tell you where your phone last was and
            show it on the map in Vox on any of your devices. Positions are encrypted, and only the most recent
            ones are kept.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-5 py-5">
          {native ? (
            <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="min-w-0 flex-1">
                <label htmlFor="share-this-phone" className="text-sm font-medium text-white">
                  Share this device’s location
                </label>
                <p className="mt-1 text-xs leading-5 text-white/55">
                  {nativeStatus?.enabled
                    ? nativeStatus.permission === "always"
                      ? "On. It updates when you move, even when Vox is closed."
                      : "On while Vox is open. Choose “Always” in Settings → Vox → Location to keep it current."
                    : "Off. Nothing about where this device is leaves it."}
                </p>
              </div>
              <Switch
                id="share-this-phone"
                checked={Boolean(nativeStatus?.enabled)}
                disabled={busy || !nativeStatus}
                onCheckedChange={(checked) => void changeThisPhone(checked)}
              />
            </div>
          ) : (
            <p className="text-sm leading-6 text-white/60">
              To share your iPhone’s location, open the Vox app on it and turn this on in Settings → Location sharing.
            </p>
          )}
          <div>
            <h3 className="mb-2 text-xs font-semibold text-white/55">Sharing devices</h3>
            {devices === null ? (
              <p className="text-sm text-white/40">Checking…</p>
            ) : devices.length === 0 ? (
              <p className="text-sm text-white/40">No devices share their location yet.</p>
            ) : (
              <ul className="space-y-2">
                {devices.map((device) => (
                  <li key={device.id} className="flex items-center gap-3 rounded-xl border border-white/8 px-3 py-2.5">
                    <Smartphone className="size-4 shrink-0 text-[#78ebff]" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-white">
                        {device.name}
                        {nativeStatus?.deviceId === device.id ? " (this device)" : ""}
                      </p>
                      <p className="truncate text-xs text-white/50">
                        {device.last ? [device.last.place, ageLabel(device.last.capturedAt)].filter(Boolean).join(" · ") : "No location yet"}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void removeDevice(device.id)}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs text-white/55 hover:bg-[#ff766c]/10 hover:text-[#ffb3ad]"
                      aria-label={`Remove ${device.name}`}
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" /> Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * iPhone app, Today: one button that does whatever step is missing: turn
 * sharing on (iOS asks for permission right there), ask for "Always", or
 * open Vox in iOS Settings when only Settings can change it.
 */
export function ShareLocationCard() {
  const [native] = useState(() => nativeLocationSharing());
  const [status, setStatus] = useState<NativeStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (native) setStatus(await native.status().catch(() => null));
  }, [native]);

  useEffect(() => {
    queueMicrotask(() => void refresh());
    // Coming back from iOS Settings.
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  if (!native || !status) return null;
  const denied = status.permission === "denied";
  const always = status.permission === "always";
  if (status.enabled && always) {
    return (
      <section className="vox-share-card" data-state="on" aria-live="polite">
        <MapPin aria-hidden="true" />
        <div>
          <p className="vox-share-title">Sharing this {/iPad/i.test(navigator.userAgent) ? "iPad" : "iPhone"}’s location</p>
          <p className="vox-share-detail">
            {status.lastPingAt ? `Last sent ${ageLabel(status.lastPingAt)}. ` : ""}It’s on the map in Today.
          </p>
        </div>
        <button
          type="button"
          className="vox-share-button is-quiet"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const sent = await native.pingNow().catch(() => false);
            setBusy(false);
            void refresh();
            if (!sent) toast.error("Couldn’t send the location right now");
          }}
        >
          Update now
        </button>
      </section>
    );
  }

  async function act() {
    if (!native || !status) return;
    setBusy(true);
    try {
      if (!status.enabled && !denied) {
        let next: NativeStatus = await shareThisDevice(native);
        if (next.permission !== "always" && native.requestAlways) next = await native.requestAlways();
        setStatus(next);
        if (next.permission === "always") toast.success("Sharing your location with Vox");
      } else if (status.enabled && !denied && native.requestAlways) {
        const next = await native.requestAlways();
        setStatus(next);
        // iOS only asks once; after that, Settings is the only way.
        if (next.permission !== "always") await native.openSettings?.();
      } else {
        await native.openSettings?.();
      }
    } catch (error) {
      if (denied || /permission/i.test(error instanceof Error ? error.message : "")) await native.openSettings?.().catch(() => false);
      else toast.error(error instanceof Error ? error.message : "Couldn’t turn on location sharing");
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  const label = denied ? "Open Settings" : status.enabled ? "Allow all the time" : "Share my location";
  const detail = denied
    ? "Location is off for Vox. Turn it on in Settings → Vox → Location, choosing “Always”."
    : status.enabled
      ? "It only updates while Vox is open. Choose “Always” so Vox knows where your phone is even when it’s closed."
      : "Put this device on your map in Vox, so you can ask “where’s my phone?” from any device.";
  return (
    <section className="vox-share-card" data-state={denied ? "denied" : status.enabled ? "partial" : "off"}>
      <MapPin aria-hidden="true" />
      <div>
        <p className="vox-share-title">{status.enabled ? "Location sharing is limited" : "Share your location with Vox"}</p>
        <p className="vox-share-detail">{detail}</p>
      </div>
      <button type="button" className="vox-share-button" disabled={busy} onClick={() => void act()}>
        {busy ? "…" : label}
      </button>
    </section>
  );
}
