"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Loader2, Lock, ShieldAlert, X } from "lucide-react";

import { browserAgentBridge } from "@/lib/browser-agent";
import { secureFillEntries, secureInputProps, type SecureFillEntry, type SecureForm } from "@/lib/secure-fill";

/**
 * The private box in the chat: the user types sign-in or card details here
 * and the Mac app writes them into the page. The values live only in these
 * inputs until they are sent to the page, and are cleared right after.
 * Fields with details saved on this Mac can be left empty: the app fills
 * those itself, and the saved values never come to this window.
 */
export function SecureFillCard({
  form,
  onFill,
  onCancel,
  onMac = false,
  savedLookup,
}: {
  form: SecureForm;
  /** The page is in the browser on the user's paired Mac, not on this device. */
  onMac?: boolean;
  /** Which fields have saved details where the page is (never the values). */
  savedLookup?: (refs: number[]) => Promise<{ canRemember: boolean; saved: Record<number, boolean> } | null>;
  /** Writes the values into the page; resolves to how many fields took them. */
  onFill: (entries: SecureFillEntry[], remember: boolean) => Promise<number>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Record<number, boolean>>({});
  const [canRemember, setCanRemember] = useState(false);
  const [remember, setRemember] = useState(true);
  useEffect(() => {
    let live = true;
    const refs = form.fields.map((field) => field.ref);
    void (savedLookup ? savedLookup(refs) : (browserAgentBridge()?.saved?.(refs) ?? Promise.resolve(null)))
      .then((result) => {
        if (!live || !result) return;
        setSaved(result.saved ?? {});
        setCanRemember(result.canRemember === true);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // Asked once per box; the lookup function itself is not a reason to ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);
  const typedAny = form.fields.some((field) => (values[field.ref] ?? "").length > 0);
  const savedCount = form.fields.filter((field) => saved[field.ref]).length;
  const ready = typedAny || savedCount > 0;
  // Things that change every time are never kept.
  const keepable = form.fields.some((field) => field.kind !== "code" && field.kind !== "card_code" && field.kind !== "text");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !ready) return;
    setBusy(true);
    const entries = secureFillEntries(form, values, saved);
    // Out of the inputs before anything else happens.
    setValues({});
    try {
      await onFill(entries, remember && canRemember && typedAny);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="secure-card" onSubmit={submit} aria-label={`Private details for ${form.host}`} autoComplete="on">
      <div className="secure-card-head">
        <span className="secure-card-lock" aria-hidden="true">
          <Lock />
        </span>
        <div>
          <p className="secure-card-title">For {form.host}</p>
          <p className="secure-card-note">
            {onMac
              ? "Sent encrypted to your Mac and typed into the page there. Vox’s AI and servers can’t read it."
              : "Goes straight into the page on this Mac. It is never sent to Vox’s AI or servers."}
          </p>
        </div>
        <button type="button" className="secure-card-close" aria-label="Close without filling in" onClick={onCancel} disabled={busy}>
          <X aria-hidden="true" />
        </button>
      </div>
      {!form.secure ? (
        <p className="secure-card-warning">
          <ShieldAlert aria-hidden="true" /> This page isn’t using a secure connection. Don’t type a password or card here.
        </p>
      ) : null}
      <div className="secure-card-fields">
        {form.fields.map((field, index) => {
          const input = secureInputProps(field.kind);
          const id = `secure-${form.id}-${field.ref}`;
          return (
            <div key={field.ref} className="secure-card-field" data-kind={field.kind}>
              <label htmlFor={id}>{field.label}</label>
              <input
                id={id}
                type={input.type}
                autoComplete={input.autoComplete}
                inputMode={input.inputMode}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                maxLength={200}
                autoFocus={index === 0 && savedCount === 0}
                placeholder={saved[field.ref] ? (onMac ? "Saved on your Mac" : "Saved on this Mac") : undefined}
                value={values[field.ref] ?? ""}
                onChange={(event) => setValues((current) => ({ ...current, [field.ref]: event.target.value }))}
                disabled={busy}
              />
            </div>
          );
        })}
      </div>
      {canRemember && keepable ? (
        <label className="secure-card-remember">
          <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} disabled={busy} />
          <span>
            {onMac ? "Remember on your Mac" : "Remember on this Mac"}
            <small>Kept encrypted in your Mac’s keychain. Codes and card security codes are never kept.</small>
          </span>
        </label>
      ) : null}
      <div className="secure-card-actions">
        <button type="submit" className="secure-card-submit" disabled={busy || !ready}>
          {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          {busy ? "Filling in…" : savedCount > 0 && !typedAny ? "Use saved details" : onMac ? "Fill in on my Mac" : "Fill in on the page"}
        </button>
        <button type="button" className="secure-card-cancel" onClick={onCancel} disabled={busy}>
          Not now
        </button>
      </div>
    </form>
  );
}
