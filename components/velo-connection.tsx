"use client";

import { useCallback, useEffect, useState } from "react";
import { Dumbbell, ExternalLink, Link2, Unlink } from "lucide-react";
import { toast } from "sonner";

import { SettingsRow } from "@/components/settings-row";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

type ConnectionStatus = { connected: boolean; siteUrl: string };

/** Starts connecting Vox to VÉLO. The user signs in to VÉLO and allows Vox, in a separate tab. */
export async function openVeloConnection() {
  const response = await fetch("/api/connections/velo", { method: "POST" });
  const payload = (await response.json().catch(() => ({}))) as { authorizeUrl?: string; error?: string };
  if (!response.ok || !payload.authorizeUrl) {
    toast.error("Couldn’t connect VÉLO", { description: payload.error });
    return;
  }
  window.open(payload.authorizeUrl, "_blank", "noopener");
  toast.info("Finish connecting in the new tab", { description: "It signs in with your Vox account and comes straight back." });
}

/** Settings → Connected accounts → VÉLO: the user's training and food notebook. */
export function VeloConnection() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/connections/velo", { cache: "no-store" });
    if (response.ok) setStatus((await response.json()) as ConnectionStatus);
  }, []);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => void refresh());
    // The connection finishes in another tab; pick it up on return.
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [open, refresh]);

  async function disconnect() {
    setBusy(true);
    try {
      await fetch("/api/connections/velo", { method: "DELETE" });
      await refresh();
      toast.success("Disconnected VÉLO", { description: "Start a new conversation for this to take effect." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <SettingsRow icon={<Dumbbell />} title="VÉLO" detail="Workouts, meals, water, sleep and habits" />
      </SheetTrigger>
      <SheetContent className="w-[min(94vw,420px)] border-white/10 bg-[#10111b] text-white sm:max-w-[420px]">
        <SheetHeader className="border-b border-white/8 px-6 py-6 pr-12">
          <div className="flex items-center gap-2 text-[#f4ff74]">
            <Dumbbell size={18} />
            <SheetTitle className="font-display text-xl text-white">VÉLO</SheetTitle>
          </div>
          <SheetDescription className="mt-2 leading-6 text-white/46">
            Your notebook for workouts, meals, water, body weight, sleep and habits. Tell Vox what you
            did (“I did 50 push-ups”) and it keeps count; ask how you’re doing and it tells you.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-3 px-5 py-5">
          {status === null ? (
            <p className="text-sm text-white/40">Checking the connection…</p>
          ) : status.connected ? (
            <>
              <p className="flex items-center gap-2 text-sm text-[#f4ff74]/85">
                <Link2 className="size-4" aria-hidden="true" /> Connected. Try “I did 20 push-ups.”
              </p>
              <p className="text-sm leading-6 text-white/55">
                Vox logs what you mention without asking, and waits for your “yes” before it deletes
                an entry or replaces your training plan.
              </p>
              <a
                href={status.siteUrl}
                target="_blank"
                rel="noopener"
                className="flex w-full items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.04] py-2 text-sm text-white hover:bg-white/10"
              >
                <ExternalLink className="size-4" aria-hidden="true" /> See today in VÉLO
              </a>
              <Button type="button" variant="ghost" disabled={busy} className="w-full rounded-full text-white/50 hover:text-[#ff9d96]" onClick={() => void disconnect()}>
                <Unlink /> Disconnect
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm leading-6 text-white/60">
                One click: it signs in with your Vox account. Start a new conversation afterwards.
              </p>
              <Button type="button" className="w-full rounded-full bg-[#f4ff74] text-[#10111b] hover:bg-[#f4ff74]/90" onClick={() => void openVeloConnection()}>
                <Link2 /> Connect VÉLO
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
