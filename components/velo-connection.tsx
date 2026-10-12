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
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/connections/velo", { cache: "no-store" });
      if (!response.ok) throw new Error("Couldn’t load your VÉLO connection.");
      setStatus((await response.json()) as ConnectionStatus);
      setError(null);
    } catch {
      setError("Couldn’t load your VÉLO connection. Try again.");
    }
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
      const response = await fetch("/api/connections/velo", { method: "DELETE" });
      if (!response.ok) throw new Error("Couldn’t disconnect VÉLO.");
      setStatus((current) => current ? { ...current, connected: false } : current);
      await refresh();
      toast.success("Disconnected VÉLO", { description: "Start a new conversation for this to take effect." });
    } catch {
      toast.error("Couldn’t disconnect VÉLO", { description: "Try again in a moment." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <SettingsRow icon={<Dumbbell />} title="VÉLO" detail="Workouts, meals, water, sleep and habits" />
      </SheetTrigger>
      <SheetContent className="vox-connection-sheet">
        <SheetHeader>
          <div className="vox-connection-heading">
            <Dumbbell size={18} />
            <SheetTitle>VÉLO</SheetTitle>
          </div>
          <SheetDescription>Your notebook for training, meals, water, sleep, and habits.</SheetDescription>
        </SheetHeader>

        <div className="vox-connection-body">
          {error ? (
            <div className="vox-connection-error" role="alert">
              <p>{error}</p>
              <Button className="vox-connection-button" onClick={() => void refresh()}>Try again</Button>
            </div>
          ) : null}
          {status === null ? (
            error ? null : <p className="vox-connection-muted" role="status">Checking the connection…</p>
          ) : status.connected ? (
            <>
              <div className="vox-connection-card">
                <p className="vox-connection-status" data-state="connected">VÉLO connected</p>
                <p className="vox-connection-muted">Try “I did 20 push-ups.”</p>
              </div>
              <section className="vox-connection-card" aria-label="Using your notebook">
                <h3 className="vox-connection-section">Keep track by voice</h3>
                <p className="vox-connection-muted">Tell Vox what you did, ate, or drank. Ask “how am I doing this week?” to hear your progress.</p>
              </section>
              <a
                href={status.siteUrl}
                target="_blank"
                rel="noopener"
                className="vox-connection-link"
              >
                <ExternalLink className="size-4" aria-hidden="true" /> See today in VÉLO
              </a>
              <Button type="button" variant="ghost" disabled={busy} className="vox-connection-button vox-connection-button--quiet vox-connection-button--danger" onClick={() => void disconnect()}>
                <Unlink /> {busy ? "Disconnecting…" : "Disconnect VÉLO"}
              </Button>
            </>
          ) : (
            <>
              <div className="vox-connection-card">
                <p className="vox-connection-status">Connect your notebook</p>
                <p className="vox-connection-muted">Use your Vox account, then start a new conversation to log entries.</p>
              </div>
              <Button type="button" className="vox-connection-button vox-connection-button--primary" onClick={() => void openVeloConnection()}>
                <Link2 /> Connect VÉLO
              </Button>
            </>
          )}
          <p className="vox-connection-note">Say “undo that” to take back the last entry. Vox waits for your “yes” before deleting older entries or replacing your training plan.</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
