"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, GraduationCap, Layers, Link2, Unlink } from "lucide-react";
import { toast } from "sonner";

import { SettingsRow } from "@/components/settings-row";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

type ConnectionStatus = { connected: boolean; siteUrl: string };

/**
 * Starts connecting Vox to Vox Flash Cards. The sign-in happens on the flash
 * card site (and Vox) in a separate tab or the system browser.
 */
export async function openFlashcardsConnection() {
  const response = await fetch("/api/connections/flashcards", { method: "POST" });
  const payload = (await response.json().catch(() => ({}))) as { authorizeUrl?: string; error?: string };
  if (!response.ok || !payload.authorizeUrl) {
    toast.error("Couldn’t connect Vox Flash Cards", { description: payload.error });
    return;
  }
  window.open(payload.authorizeUrl, "_blank", "noopener");
  toast.info("Finish connecting in the new tab", {
    description: "Sign in with your Vox account and allow Vox to use your flash cards.",
  });
}

export function FlashcardsConnection({
  studying,
  onStudy,
  onStopStudy,
}: {
  studying: boolean;
  onStudy: () => void;
  onStopStudy: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/connections/flashcards", { cache: "no-store" });
      if (!response.ok) throw new Error("The Flash Cards connection could not load.");
      setStatus((await response.json()) as ConnectionStatus);
      setError("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The Flash Cards connection could not load.");
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
      const response = await fetch("/api/connections/flashcards", { method: "DELETE" });
      if (!response.ok) throw new Error("Flash Cards could not be disconnected.");
      setStatus((current) => current ? { ...current, connected: false } : current);
      await refresh();
      toast.success("Disconnected Vox Flash Cards");
    } catch {
      toast.error("Couldn’t disconnect Vox Flash Cards", { description: "Try again in a moment." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <SettingsRow
          icon={<Layers />}
          title="Flash cards"
          detail={studying ? "Studying now" : "Vox Flash Cards: study decks by voice"}
          tone={studying ? "ok" : "default"}
        />
      </SheetTrigger>
      <SheetContent className="vox-connection-sheet">
        <SheetHeader>
          <div className="vox-connection-heading">
            <Layers size={18} aria-hidden="true" />
            <SheetTitle>Flash cards</SheetTitle>
          </div>
          <SheetDescription>
            Keep your decks in Vox Flash Cards, then review one card at a time by voice.
          </SheetDescription>
        </SheetHeader>

        <div className="vox-connection-body">
          {error && (
            <div className="vox-connection-error" role="alert">
              <p>{error}</p>
              <Button type="button" variant="ghost" className="vox-connection-button vox-connection-button--quiet mt-2" onClick={() => void refresh()}>Retry</Button>
            </div>
          )}
          {status === null ? (
            !error && <p className="vox-connection-muted" role="status">Checking the connection…</p>
          ) : status.connected ? (
            <>
              <div className="vox-connection-card">
                <p className="vox-connection-status" data-state="connected">
                  <Link2 className="size-4" aria-hidden="true" /> Connected to Vox Flash Cards
                </p>
                <p className="vox-connection-note">{studying ? "A study session is in progress." : "Your decks are ready to review with Vox."}</p>
              </div>
              <div className="vox-connection-actions">
                {studying ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="vox-connection-button"
                    onClick={() => { setOpen(false); onStopStudy(); }}
                  >Stop studying</Button>
                ) : (
                  <Button
                    type="button"
                    className="vox-connection-button vox-connection-button--primary"
                    onClick={() => { setOpen(false); onStudy(); }}
                  ><GraduationCap /> Study with Vox</Button>
                )}
                <a href={status.siteUrl} target="_blank" rel="noopener" className="vox-connection-link">
                  <ExternalLink className="size-4" aria-hidden="true" /> Manage decks and cards
                </a>
              </div>
              <div className="vox-connection-card">
                <p className="vox-connection-section">Review by voice</p>
                <p className="vox-connection-note">Say “let’s review my flash cards.” Vox grades your answer before moving on. Say “skip” to leave a card ungraded.</p>
              </div>
              <Button type="button" variant="ghost" disabled={busy} className="vox-connection-button vox-connection-button--danger" onClick={() => void disconnect()}>
                <Unlink /> {busy ? "Disconnecting…" : "Disconnect Flash Cards"}
              </Button>
            </>
          ) : (
            <>
              <div className="vox-connection-card">
                <p className="vox-connection-status" data-state="warning">Not connected</p>
                <p className="vox-connection-note">Sign in with your Vox account on Vox Flash Cards, then allow Vox to access your decks.</p>
              </div>
              <div className="vox-connection-actions">
                <Button type="button" className="vox-connection-button vox-connection-button--primary" onClick={() => void openFlashcardsConnection()}>
                  <Link2 /> Connect Flash Cards
                </Button>
                <a href={status.siteUrl} target="_blank" rel="noopener" className="vox-connection-link">
                  <ExternalLink className="size-4" aria-hidden="true" /> Open Vox Flash Cards
                </a>
              </div>
              <p className="vox-connection-muted">You can also create and study cards directly on the site.</p>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
