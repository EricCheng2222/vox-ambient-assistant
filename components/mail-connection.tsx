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
function AccountRow({ account, siteUrl }: { account: MailAccountDetail; siteUrl: string }) {
  const missing = account.google ? GOOGLE_PARTS.filter(([key]) => !account.google?.[key]) : [];
  return (
    <li className="vox-connection-card vox-mail-account">
      <p className="vox-mail-address">{account.email}</p>
      <p className="vox-mail-meta">
        {account.kind}
        {account.primary ? ", sends by default" : ""}
      </p>
      {account.needsReconnect ? (
        <p className="vox-connection-muted mt-2">Access expired. Reconnect this account to keep using it.</p>
      ) : (
        <ul className="vox-mail-access" aria-label={`What Vox can use in ${account.email}`}>
          <li>Mail</li>
          {GOOGLE_PARTS.map(([key, label]) =>
            account.google?.[key] ? (
              <li key={key}>
                {label}
              </li>
            ) : account.google ? (
              <li key={key} data-allowed="false">
                {label}<span className="sr-only">: not allowed yet</span>
              </li>
            ) : null,
          )}
        </ul>
      )}
      {account.google && (missing.length > 0 || account.needsReconnect) ? (
        <Button
          type="button"
          variant="outline"
          className="vox-connection-button"
          onClick={() => void openMailConnection({ provider: "google", add: true, loginHint: account.email })}
        >
          <Link2 /> {account.needsReconnect ? "Reconnect Google" : `Allow ${missing.map(([, label]) => label.toLowerCase()).join(", ")}`}
        </Button>
      ) : null}
      {!account.google && account.needsReconnect ? (
        <a href={siteUrl} target="_blank" rel="noopener" className="vox-connection-link mt-3">
          <ExternalLink className="size-4" aria-hidden="true" /> Reconnect account
        </a>
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
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/connections/mail", { cache: "no-store" });
      if (!response.ok) throw new Error("Couldn’t load your email connection.");
      setStatus((await response.json()) as ConnectionStatus);
      setError(null);
    } catch {
      setError("Couldn’t load your email connection. Try again.");
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
      const response = await fetch("/api/connections/mail", { method: "DELETE" });
      if (!response.ok) throw new Error("Couldn’t disconnect your email.");
      setStatus((current) => current ? { ...current, connected: false } : current);
      await refresh();
      toast.success("Disconnected your email", {
        description: "Vox can no longer read or send your mail. Start a new conversation for this to take effect.",
      });
    } catch {
      toast.error("Couldn’t disconnect your email", { description: "Try again in a moment." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <SettingsRow icon={<Mail />} title="Email" detail="Gmail, Outlook, iCloud, and other accounts" />
      </SheetTrigger>
      <SheetContent className="vox-connection-sheet">
        <SheetHeader>
          <div className="vox-connection-heading">
            <Mail size={18} />
            <SheetTitle>Email</SheetTitle>
          </div>
          <SheetDescription>
            Read, search, and reply across your accounts with Vox.
          </SheetDescription>
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
                <p className="vox-connection-status" data-state="connected">Vox Mail connected</p>
                <p className="vox-connection-muted">Try “any new email?”</p>
              </div>
              <section aria-label="Email accounts">
                <h3 className="vox-connection-section">Email accounts</h3>
              {status.accounts?.length ? (
                <ul className="vox-mail-accounts" aria-label="Connected accounts">
                  {status.accounts.map((account) => (
                    <AccountRow key={account.email} account={account} siteUrl={status.siteUrl} />
                  ))}
                </ul>
              ) : status.accounts ? (
                <p className="vox-connection-muted">No email account is connected yet. Add one below.</p>
              ) : (
                <p className="vox-connection-muted">Couldn’t list your accounts right now.</p>
              )}
              </section>
              <a
                href={status.siteUrl}
                target="_blank"
                rel="noopener"
                className="vox-connection-link"
              >
                <ExternalLink className="size-4" aria-hidden="true" /> Add or remove email accounts
              </a>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                className="vox-connection-button vox-connection-button--quiet vox-connection-button--danger"
                onClick={() => void disconnect()}
              >
                <Unlink /> {busy ? "Disconnecting…" : "Disconnect Vox Mail"}
              </Button>
            </>
          ) : (
            <>
              <div className="vox-connection-card">
                <p className="vox-connection-status">Choose an email provider</p>
                <p className="vox-connection-muted">Sign in with your provider, then start a new conversation in Vox.</p>
              </div>
              <div className="vox-connection-actions">
              <Button
                type="button"
                className="vox-connection-button vox-connection-button--primary"
                onClick={() => void openMailConnection({ provider: "google" })}
              >
                <Link2 /> Connect Gmail
              </Button>
              <Button
                type="button"
                variant="outline"
                className="vox-connection-button"
                onClick={() => void openMailConnection({ provider: "microsoft" })}
              >
                Connect Outlook
              </Button>
              <Button
                type="button"
                variant="outline"
                className="vox-connection-button"
                onClick={() => void openMailConnection({ provider: "imap" })}
              >
                iCloud, Yahoo, or another account
              </Button>
              </div>
            </>
          )}
          <p className="vox-connection-note">
            <ShieldCheck aria-hidden="true" />
            Vox previews messages and waits for your “yes” before sending, replying, forwarding, or moving email to the trash.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
