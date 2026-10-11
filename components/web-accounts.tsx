"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Globe2, LogIn, LogOut, Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { SettingsRow } from "@/components/settings-row";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { savedKindNames, vaultBridge, type SavedDetails } from "@/lib/secure-fill";
import { WEB_ACCOUNT_CATEGORIES, WEB_ACCOUNT_SERVICES, webAccountBridge, webAccountChecks, type WebAccountService } from "@/lib/web-accounts";

/**
 * Settings → Connected accounts → Websites. The sites the user has signed in
 * to inside Vox's built-in browser (Mac app), and the ones they can add.
 * Signing in opens the site itself; the user types their own password there.
 */
export function WebAccounts({
  onSignIn,
  onChange,
  remoteStatus,
}: {
  onSignIn: (url: string, name: string) => void;
  onChange?: (signedInIds: string[]) => void;
  /** On a phone or tablet with a paired Mac: asks the Mac which sites are signed in there. */
  remoteStatus?: (checks: ReturnType<typeof webAccountChecks>) => Promise<Record<string, boolean>>;
}) {
  const [bridge] = useState(() => webAccountBridge());
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Record<string, boolean> | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  // Sign-ins and card details remembered on this Mac for the private box (names only).
  const [savedDetails, setSavedDetails] = useState<SavedDetails | null>(null);
  const refreshSaved = useCallback(async () => {
    const next = await vaultBridge()?.list().catch(() => null);
    if (next) setSavedDetails(next);
  }, []);
  useEffect(() => {
    if (open) queueMicrotask(() => void refreshSaved());
  }, [open, refreshSaved]);
  async function forgetSaved(target: string, name: string) {
    await vaultBridge()?.forget(target).catch(() => false);
    await refreshSaved();
    toast.success(`Forgot the saved details for ${name}`);
  }

  // The latest callback, without making every render look like a change.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const remoteStatusRef = useRef(remoteStatus);
  useEffect(() => {
    remoteStatusRef.current = remoteStatus;
  }, [remoteStatus]);
  const viaMac = !bridge && Boolean(remoteStatus);

  const refresh = useCallback(async () => {
    const local = webAccountBridge();
    const next = local ? await local.status(webAccountChecks()).catch(() => null) : ((await remoteStatusRef.current?.(webAccountChecks()).catch(() => null)) ?? null);
    if (!next) return;
    setStatus(next);
    onChangeRef.current?.(Object.keys(next).filter((id) => next[id]));
  }, []);

  // Once at start, so the row can say how many; then while the sheet is open.
  useEffect(() => {
    if (bridge || viaMac) queueMicrotask(() => void refresh());
  }, [bridge, viaMac, refresh]);
  // Through the Mac each check is a round trip: once when the sheet opens is enough.
  useEffect(() => {
    if (open && viaMac) queueMicrotask(() => void refresh());
  }, [open, viaMac, refresh]);
  useEffect(() => {
    if (!open || !bridge) return;
    const timer = window.setInterval(() => void refresh(), 4_000);
    return () => window.clearInterval(timer);
  }, [open, bridge, refresh]);

  const signedIn = useMemo(() => WEB_ACCOUNT_SERVICES.filter((item) => status?.[item.id]), [status]);
  const matches = (item: WebAccountService) => !query.trim() || `${item.name} ${item.category}`.toLowerCase().includes(query.trim().toLowerCase());

  async function signOut(item: WebAccountService) {
    setBusy(item.id);
    try {
      await bridge?.signOut(item.domains);
      await refresh();
      toast.success(`Signed out of ${item.name} in Vox`);
    } catch {
      toast.error(`Couldn’t sign out of ${item.name}`);
    } finally {
      setBusy(null);
    }
  }

  const row = (item: WebAccountService) => {
    const connected = Boolean(status?.[item.id]);
    return (
      <li key={item.id} className="flex items-center gap-3 px-1 py-2">
        <span className={`size-2 shrink-0 rounded-full ${connected ? "bg-[#f4ff74]" : "bg-white/15"}`} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-white">{item.name}</span>
          {connected ? <span className="block text-xs text-white/45">{viaMac ? "Signed in on your Mac" : "Signed in"}</span> : null}
        </span>
        {bridge ? (
          connected ? (
            <button
              type="button"
              disabled={busy !== null}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs text-white/50 hover:bg-white/5 hover:text-[#ff9d96]"
              onClick={() => void signOut(item)}
            >
              <LogOut className="size-3.5" aria-hidden="true" /> Sign out
            </button>
          ) : (
            <button
              type="button"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 text-xs text-white hover:bg-white/10"
              onClick={() => {
                setOpen(false);
                onSignIn(item.url, item.name);
                toast.info(`Sign in to ${item.name} on the page`, { description: "Type your own password there. Vox never types or sees it." });
              }}
            >
              <LogIn className="size-3.5" aria-hidden="true" /> Sign in
            </button>
          )
        ) : null}
      </li>
    );
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <SettingsRow
          icon={<Globe2 />}
          title="Websites"
          detail={bridge || viaMac ? (signedIn.length ? `Signed in to ${signedIn.length}: ${signedIn.slice(0, 3).map((item) => item.name).join(", ")}${signedIn.length > 3 ? "…" : ""}` : "Amazon, Uber, Airbnb, Instagram, and more") : "Sign in to sites in the Vox Mac app"}
        />
      </SheetTrigger>
      <SheetContent className="flex w-[min(94vw,440px)] flex-col border-white/10 bg-[#10111b] text-white sm:max-w-[440px]">
        <SheetHeader className="border-b border-white/8 px-6 py-6 pr-12">
          <div className="flex items-center gap-2 text-[#f4ff74]">
            <Globe2 size={18} />
            <SheetTitle className="font-display text-xl text-white">Websites</SheetTitle>
          </div>
          <SheetDescription className="mt-2 leading-6 text-white/46">
            Sign in to a site here and Vox can use it for you: check an order, find a ride, read a message, fill in a form.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
          <p className="flex gap-2 text-sm leading-6 text-white/55">
            <ShieldCheck className="mt-1 size-4 shrink-0" aria-hidden="true" />
            You type your own password on the site itself; Vox never types or sees it. It asks out loud before it
            orders, pays, sends, or deletes anything. Sign-ins stay on this Mac.
          </p>
          {!bridge ? (
            <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm leading-6 text-white/60">
              {viaMac
                ? "From here Vox uses these sites through your paired Mac, so it works while the Mac is on with Vox open. Sign in to a new site on the Mac."
                : "Signing in to websites works in the Vox Mac app, which has a built-in browser. Pair this device with your Mac and Vox can use those sign-ins from here."}
            </p>
          ) : null}

          {signedIn.length > 0 ? (
            <section aria-labelledby="web-accounts-connected">
              <h3 id="web-accounts-connected" className="text-xs font-semibold text-white/50">
                Signed in
              </h3>
              <ul className="mt-1 divide-y divide-white/8">{signedIn.map(row)}</ul>
            </section>
          ) : null}

          {savedDetails && (savedDetails.sites.length > 0 || savedDetails.anywhere.length > 0) ? (
            <section aria-labelledby="web-accounts-saved">
              <h3 id="web-accounts-saved" className="text-xs font-semibold text-white/50">
                Remembered on this Mac
              </h3>
              <ul className="mt-1 divide-y divide-white/8">
                {savedDetails.anywhere.length > 0 ? (
                  <li className="flex items-center gap-3 px-1 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-white">Card and contact details</span>
                      <span className="block text-xs text-white/45">{savedKindNames(savedDetails.anywhere)}</span>
                    </span>
                    <button type="button" className="min-h-9 rounded-full px-3 text-xs text-white/50 hover:bg-white/5 hover:text-[#ff9d96]" onClick={() => void forgetSaved("anywhere", "your card and contact details")}>
                      Forget
                    </button>
                  </li>
                ) : null}
                {savedDetails.sites.map((site) => (
                  <li key={site.host} className="flex items-center gap-3 px-1 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-white">{site.host}</span>
                      <span className="block text-xs text-white/45">{savedKindNames(site.kinds)}</span>
                    </span>
                    <button type="button" className="min-h-9 rounded-full px-3 text-xs text-white/50 hover:bg-white/5 hover:text-[#ff9d96]" onClick={() => void forgetSaved(site.host, site.host)}>
                      Forget
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <label className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3">
            <Search className="size-4 shrink-0 text-white/40" aria-hidden="true" />
            <span className="sr-only">Find a website</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a website"
              className="h-10 w-full bg-transparent text-sm text-white outline-none placeholder:text-white/35"
            />
          </label>

          {WEB_ACCOUNT_CATEGORIES.map((category) => {
            const items = WEB_ACCOUNT_SERVICES.filter((item) => item.category === category && !status?.[item.id] && matches(item));
            if (!items.length) return null;
            return (
              <section key={category} aria-label={category}>
                <h3 className="text-xs font-semibold text-white/50">{category}</h3>
                <ul className="mt-1 divide-y divide-white/8">{items.map(row)}</ul>
              </section>
            );
          })}
          <p className="text-xs leading-5 text-white/40">
            Not listed? Ask Vox to open any site, sign in on the page, and it works the same way. Banks and payment
            services are left out on purpose. Some sites refuse “Sign in with Google” inside another app; use the
            site’s own password there.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
