"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, GraduationCap, Layers, Link2, Unlink } from "lucide-react";
import { toast } from "sonner";

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

  const refresh = useCallback(async () => {
    const response = await fetch("/api/connections/flashcards", { cache: "no-store" });
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
      await fetch("/api/connections/flashcards", { method: "DELETE" });
      await refresh();
      toast.success("Disconnected Vox Flash Cards");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={`rounded-full border-white/10 bg-white/[0.04] text-white/66 shadow-none hover:bg-white/10 hover:text-white ${
            studying ? "border-[#f4ff74]/40 text-[#f4ff74]" : ""
          }`}
          aria-label={studying ? "Flash cards, studying now" : "Flash cards"}
        >
          <Layers />
          {studying ? "Studying" : null}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[min(94vw,420px)] border-white/10 bg-[#10111b] text-white sm:max-w-[420px]">
        <SheetHeader className="border-b border-white/8 px-6 py-6 pr-12">
          <div className="flex items-center gap-2 text-[#f4ff74]">
            <Layers size={18} />
            <SheetTitle className="font-display text-xl text-white">Flash cards</SheetTitle>
          </div>
          <SheetDescription className="mt-2 leading-6 text-white/46">
            Your cards live on Vox Flash Cards. Connect it once, then say “let’s review my flash
            cards” and Vox will quiz you like a friend.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-3 px-5 py-5">
          {status === null ? (
            <p className="text-sm text-white/40">Checking the connection…</p>
          ) : status.connected ? (
            <>
              <p className="flex items-center gap-2 text-sm text-[#f4ff74]/85">
                <Link2 className="size-4" aria-hidden="true" /> Connected to Vox Flash Cards
              </p>
              {studying ? (
                <Button
                  type="button"
                  className="w-full rounded-full border-white/15 bg-transparent text-white hover:bg-white/10"
                  variant="outline"
                  onClick={() => {
                    setOpen(false);
                    onStopStudy();
                  }}
                >
                  Stop studying
                </Button>
              ) : (
                <Button
                  type="button"
                  className="w-full rounded-full bg-[#f4ff74] text-[#10111b] hover:bg-[#f4ff74]/90"
                  onClick={() => {
                    setOpen(false);
                    onStudy();
                  }}
                >
                  <GraduationCap /> Study with Vox
                </Button>
              )}
              <a
                href={status.siteUrl}
                target="_blank"
                rel="noopener"
                className="flex w-full items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.04] py-2 text-sm text-white hover:bg-white/10"
              >
                <ExternalLink className="size-4" aria-hidden="true" /> Manage cards on Vox Flash Cards
              </a>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                className="w-full rounded-full text-white/50 hover:text-[#ff9d96]"
                onClick={() => void disconnect()}
              >
                <Unlink /> Disconnect
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm leading-6 text-white/60">
                Vox isn’t connected to your flash cards yet. You’ll sign in with your Vox account on
                Vox Flash Cards and allow Vox to use your cards.
              </p>
              <Button
                type="button"
                className="w-full rounded-full bg-[#f4ff74] text-[#10111b] hover:bg-[#f4ff74]/90"
                onClick={() => void openFlashcardsConnection()}
              >
                <Link2 /> Connect Vox Flash Cards
              </Button>
              <a
                href={status.siteUrl}
                target="_blank"
                rel="noopener"
                className="block text-center text-xs text-white/45 underline-offset-2 hover:underline"
              >
                Open Vox Flash Cards
              </a>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
