"use client";

import { useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";

type TextsStatus = {
  available: boolean;
  smsCapable?: boolean;
  enabled?: boolean;
  otherWebhook?: boolean;
};

/**
 * Settings → Phone assistant: whether texts to Vox's phone number show up in
 * the conversation stream. Turning it on points the number's "A message comes
 * in" webhook at Vox.
 */
export function PhoneTexts() {
  const [status, setStatus] = useState<TextsStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/phone-assistant/texts", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as TextsStatus & { error?: string };
        if (cancelled) return;
        if (response.ok) setStatus(payload);
        else setError(payload.error ?? "Couldn’t check the phone number.");
      })
      .catch(() => {
        if (!cancelled) setError("Couldn’t check the phone number.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function change(enabled: boolean) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/phone-assistant/texts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const payload = (await response.json().catch(() => ({}))) as TextsStatus & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Couldn’t change it.");
      setStatus(payload);
      toast.success(enabled ? "Texts will show up in Vox" : "Texts are off", {
        description: enabled ? "New texts to Vox’s number appear in the conversation stream and in Today." : undefined,
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn’t change it.");
    } finally {
      setBusy(false);
    }
  }

  if (status && !status.available) return null;

  return (
    <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-start gap-3">
        <MessageSquare className="mt-0.5 size-4 shrink-0 text-[#78ebff]" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <label htmlFor="phone-texts" className="text-sm font-medium text-white">
            Show texts in Vox
          </label>
          <p className="mt-1 text-xs leading-5 text-white/55">
            Texts to Vox’s number appear in the conversation stream and in Today. Vox never replies
            on its own, and treats what a text says as someone else’s words, not a request from you.
          </p>
          {status?.smsCapable === false && (
            <p className="mt-2 text-xs text-[#f0c887]">This number can’t receive texts.</p>
          )}
          {status?.otherWebhook && !status.enabled && (
            <p className="mt-2 text-xs text-[#f0c887]">
              Texts currently go somewhere else. Turning this on sends them to Vox instead.
            </p>
          )}
        </div>
        <Switch
          id="phone-texts"
          checked={Boolean(status?.enabled)}
          disabled={!status || busy || status.smsCapable === false}
          onCheckedChange={(checked) => void change(checked)}
        />
      </div>
      {error && <p className="mt-3 text-xs text-[#ffaaa4]">{error}</p>}
    </div>
  );
}
