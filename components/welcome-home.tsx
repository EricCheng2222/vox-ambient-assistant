"use client";

import { useEffect, useState } from "react";
import { Home, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

type PhoneBridge = { enabled: boolean; setEnabled: (on: boolean) => void; test?: () => void };
type DesktopStatus = {
  enabled: boolean;
  sound: string;
  sounds: Array<{ id: string; label: string }>;
  paired: boolean;
  bluetooth: string;
  lastGreetedAt: string | null;
};
type DesktopBridge = {
  status: () => Promise<DesktopStatus>;
  update: (changes: { enabled?: boolean; sound?: string }) => Promise<DesktopStatus>;
  test: (sound?: string) => Promise<boolean>;
};

function phoneBridge(): PhoneBridge | null {
  if (typeof window === "undefined") return null;
  return (window as { voxNativeIOS?: { welcomeHome?: PhoneBridge } }).voxNativeIOS?.welcomeHome ?? null;
}

function desktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  return (window as { voxLocalCodex?: { welcomeHome?: DesktopBridge } }).voxLocalCodex?.welcomeHome ?? null;
}

/** In the iPhone app: turns on watching for the paired Mac. */
export function WelcomeHomePhoneToggle() {
  const [bridge] = useState(() => phoneBridge());
  const [enabled, setEnabled] = useState(() => bridge?.enabled ?? false);
  if (!bridge) return null;
  return (
    <label className="flex items-start justify-between gap-4 rounded-2xl border border-white/9 bg-white/[0.035] p-4">
      <span>
        <span className="flex items-center gap-2 text-sm font-semibold text-white/86">
          <Home className="size-4" /> Welcome home greeting
        </span>
        <span className="mt-2 block text-xs leading-5 text-white/44">
          When you come within a few metres of your Mac after 3 or more hours away, the Mac
          greets you. Uses Bluetooth; iPhone will ask once.
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-3">
        <Switch
          checked={enabled}
          onCheckedChange={(on) => {
            setEnabled(on);
            bridge.setEnabled(on);
          }}
          aria-label="Welcome home greeting"
        />
        {enabled && bridge.test && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-full border-white/12 bg-transparent text-white hover:bg-white/10"
            onClick={() => bridge.test?.()}
          >
            <Play /> Test
          </Button>
        )}
      </span>
    </label>
  );
}

const BLUETOOTH_LABEL: Record<string, string> = {
  on: "Ready: waiting for your iPhone",
  off: "Bluetooth is off on this Mac",
  unauthorized: "Allow Bluetooth for Vox in System Settings › Privacy & Security",
  unsupported: "This Mac can’t advertise over Bluetooth",
  unavailable: "The greeting isn’t installed in this copy of Vox",
};

/** On the Mac: the greeting's switch, status, and a preview. */
export function WelcomeHomeDesktopSection() {
  const [bridge] = useState(() => desktopBridge());
  const [status, setStatus] = useState<DesktopStatus | null>(null);

  useEffect(() => {
    if (!bridge) return;
    let active = true;
    const load = () => void bridge.status().then((next) => active && setStatus(next)).catch(() => undefined);
    load();
    const timer = window.setInterval(load, 5_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [bridge]);

  if (!bridge || !status) return null;
  const detail = !status.paired
    ? "Pair your iPhone with this Mac first (Vox on iPhone › Mac control)."
    : !status.enabled
      ? "Off."
      : (BLUETOOTH_LABEL[status.bluetooth] ?? "Starting…");

  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3.5">
      <div className="flex items-start justify-between gap-4">
        <span>
          <span className="block text-sm font-medium text-white">Welcome home greeting</span>
          <span className="mt-1 block text-xs leading-5 text-white/46">
            Plays “Welcome home, sir.” when you come within a few metres of this Mac after 3 or
            more hours away. Turn it on in the Vox iPhone app too.
          </span>
        </span>
        <Switch
          checked={status.enabled}
          onCheckedChange={(on) => void bridge.update({ enabled: on }).then(setStatus)}
          aria-label="Welcome home greeting"
        />
      </div>
      <p className="mt-3 text-xs leading-5 text-white/46">
        {detail}
        {status.lastGreetedAt ? ` Last greeting ${new Date(status.lastGreetedAt).toLocaleString()}.` : ""}
      </p>
      <p className="mt-4 text-xs font-medium text-white/70">Sound</p>
      <div className="mt-2 space-y-1.5" role="radiogroup" aria-label="Greeting sound">
        {status.sounds.map((sound) => {
          const chosen = sound.id === status.sound;
          return (
            <div
              key={sound.id}
              className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition ${
                chosen ? "bg-[#f4ff74]/[0.1] ring-1 ring-[#f4ff74]/30" : "bg-white/[0.035] hover:bg-white/[0.06]"
              }`}
            >
              <button
                type="button"
                role="radio"
                aria-checked={chosen}
                className="flex flex-1 items-center gap-2 text-left text-sm text-white/80"
                onClick={() => void bridge.update({ sound: sound.id }).then(setStatus)}
              >
                <span
                  className={`grid size-4 place-items-center rounded-full border ${chosen ? "border-[#f4ff74]" : "border-white/30"}`}
                  aria-hidden="true"
                >
                  {chosen && <span className="size-2 rounded-full bg-[#f4ff74]" />}
                </span>
                {sound.label}
              </button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="rounded-full text-white/60 hover:bg-white/10 hover:text-white"
                aria-label={`Play ${sound.label}`}
                onClick={() => void bridge.test(sound.id)}
              >
                <Play />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
