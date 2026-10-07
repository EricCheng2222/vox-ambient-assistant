"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Link2, Mail, ShieldCheck, Unlink } from "lucide-react";
import { toast } from "sonner";

import { SettingsRow } from "@/components/settings-row";
import type { MailAccountDetail } from "@/lib/today-parse";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

type ConnectionStatus = { connected: boolean; siteUrl: string; accounts?: MailAccountDetail[] | null };

const GOOGLE_PARTS = [
  ["calendar", "Calendar"],
  ["tasks", "Tasks"],
  ["contacts", "Contacts"],
  ["drive", "Drive"],
] as const;

/** One connected account: its address, and what Vox can use in it. */
function AccountRow({ account }: { account: MailAccountDetail }) {
  const missing = account.google ? GOOGLE_PARTS.filter(([key]) => !account.google?.[key]) : [];
  return (
    <li className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <p className="truncate text-sm font-medium text-white">{account.email}</p>
      <p className="mt-0.5 text-xs text-white/50">
        {account.kind}
        {account.primary ? ", sends by default" : ""}
      </p>
      {account.needsReconnect ? (
        <p className="mt-2 text-xs text-[#f0c887]">Access expired. Reconnect this account to keep using it.</p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={`What Vox can use in ${account.email}`}>
          <li className="rounded-full border border-white/10 px-2 py-0.5 text-xs text-[#78ebff]">Mail</li>
          {GOOGLE_PARTS.map(([key, label]) =>
            account.google?.[key] ? (
              <li key={key} className="rounded-full border border-white/10 px-2 py-0.5 text-xs text-[#78ebff]">
                {label}
              </li>
            ) : account.google ? (
              <li key={key} className="rounded-full border border-dashed border-white/15 px-2 py-0.5 text-xs text-white/40">
                {label}: not allowed yet
              </li>
            ) : null,
          )}
        </ul>
      )}
      {account.google && (missing.length > 0 || account.needsReconnect) ? (
        <Button
          type="button"
          variant="outline"
          className="mt-3 w-full rounded-full border-white/10 bg-white/[0.04] text-white hover:bg-white/10 hover:text-white"
          onClick={() => void openMailConnection({ provider: "google", add: true, loginHint: account.email })}
        >
          <Link2 /> {account.needsReconnect ? "Reconnect Google" : `Allow ${missing.map(([, label]) => label.toLowerCase()).join(", ")}`}
        </Button>
      ) : null}
    </li>
  );
}

/**
 * Starts connecting Vox to Vox Mail. The user signs in with their Vox account
 * and then connects their email accounts, in a separate tab.
 */
export async function openMailConnection(options: { provider?: "google" | "microsoft" | "imap"; add?: boolean; loginHint?: string } = {}) {
  const response = await fetch("/api/connections/mail", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
  const payload = (await response.json().catch(() => ({}))) as { authorizeUrl?: string; error?: string };
  if (!response.ok || !payload.authorizeUrl) {
    toast.error("Couldn’t connect your email", { description: payload.error });
    return;
  }
  window.open(payload.authorizeUrl, "_blank", "noopener");
  toast.info("Finish connecting in the new tab", {
    description: "Allow access there and you’ll come straight back.",
  });
}

export function MailConnection() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/connections/mail", { cache: "no-store" });
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
      await fetch("/api/connections/mail", { method: "DELETE" });
      await refresh();
      toast.success("Disconnected your email", {
        description: "Vox can no longer read or send your mail. Start a new conversation for this to take effect.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <SettingsRow icon={<Mail />} title="Email" detail="Gmail, Outlook, iCloud, and other accounts" />
      </SheetTrigger>
      <SheetContent className="w-[min(94vw,420px)] border-white/10 bg-[#10111b] text-white sm:max-w-[420px]">
        <SheetHeader className="border-b border-white/8 px-6 py-6 pr-12">
          <div className="flex items-center gap-2 text-[#f4ff74]">
            <Mail size={18} />
            <SheetTitle className="font-display text-xl text-white">Email</SheetTitle>
          </div>
          <SheetDescription className="mt-2 leading-6 text-white/46">
            Connect Gmail, Outlook, iCloud, or any other email account, and Vox can check,
            search, read, draft, reply, file, and tidy your email by voice.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-3 px-5 py-5">
          {status === null ? (
            <p className="text-sm text-white/40">Checking the connection…</p>
          ) : status.connected ? (
            <>
              <p className="flex items-center gap-2 text-sm text-[#f4ff74]/85">
                <Link2 className="size-4" aria-hidden="true" /> Connected. Try “any new email?”
              </p>
              <p className="flex gap-2 text-sm leading-6 text-white/55">
                <ShieldCheck className="mt-1 size-4 shrink-0" aria-hidden="true" />
                Vox reads back who it’s writing to and what it will say, and waits for your “yes”,
                before it sends, replies, forwards, or moves mail to the trash.
              </p>
              {status.accounts?.length ? (
                <ul className="space-y-2" aria-label="Connected accounts">
                  {status.accounts.map((account) => (
                    <AccountRow key={account.email} account={account} />
                  ))}
                </ul>
              ) : status.accounts ? (
                <p className="text-sm text-white/55">No email account is connected yet. Add one below.</p>
              ) : (
                <p className="text-sm text-white/55">Couldn’t list your accounts right now.</p>
              )}
              <a
                href={status.siteUrl}
                target="_blank"
                rel="noopener"
                className="flex w-full items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.04] py-2 text-sm text-white hover:bg-white/10"
              >
                <ExternalLink className="size-4" aria-hidden="true" /> Add or remove email accounts
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
                Pick your account, allow access, and you’re back here connected. Start a new
                conversation afterwards.
              </p>
              <Button
                type="button"
                className="w-full rounded-full bg-[#f4ff74] text-[#10111b] hover:bg-[#f4ff74]/90"
                onClick={() => void openMailConnection({ provider: "google" })}
              >
                <Link2 /> Connect Gmail
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full rounded-full border-white/10 bg-white/[0.04] text-white hover:bg-white/10 hover:text-white"
                onClick={() => void openMailConnection({ provider: "microsoft" })}
              >
                Connect Outlook
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full rounded-full border-white/10 bg-white/[0.04] text-white hover:bg-white/10 hover:text-white"
                onClick={() => void openMailConnection({ provider: "imap" })}
              >
                iCloud, Yahoo, or another account
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
