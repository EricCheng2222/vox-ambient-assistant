"use client";

import { useCallback, useEffect, useState } from "react";
import { MoonStar, RefreshCw, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import type { ProfileView } from "@/lib/profile-response";

function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

function sameDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}

/** "Updated last night at 3:12", "Updated today at 14:05", "Updated Oct 3 at 3:12". */
export function describeUpdated(updatedAt: string | null, now = new Date()) {
  if (!updatedAt) return "";
  const when = new Date(updatedAt);
  if (Number.isNaN(when.getTime())) return "";
  const time = when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(when, now)) return `Updated ${when.getHours() < 6 ? "last night" : "today"} at ${time}`;
  if (sameDay(when, yesterday)) return `Updated ${when.getHours() >= 18 ? "last night" : "yesterday"} at ${time}`;
  return `Updated ${when.toLocaleDateString([], { month: "short", day: "numeric" })} at ${time}`;
}

function describeDay(day: string, now = new Date()) {
  const [year, month, date] = day.split("-").map(Number);
  const when = new Date(year, month - 1, date);
  if (sameDay(when, now)) return "Today";
  if (sameDay(when, new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return "Yesterday";
  return when.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

/**
 * Settings: what Vox has learned about you. Vox rebuilds it overnight from
 * the day's conversations; here you can read it, remove one thing, bring it
 * up to date now, or erase it all.
 */
export function ProfileCard() {
  const [view, setView] = useState<ProfileView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [updating, setUpdating] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [confirmingErase, setConfirmingErase] = useState(false);
  const [erasing, setErasing] = useState(false);

  const send = useCallback(async (path: string, init?: RequestInit) => {
    const response = await fetch(path, {
      cache: "no-store",
      ...init,
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    });
    const payload = (await response.json().catch(() => ({}))) as ProfileView & { error?: string; messages?: number };
    if (!response.ok) throw new Error(payload.error ?? "Something went wrong. Try again.");
    return payload;
  }, []);

  useEffect(() => {
    let cancelled = false;
    send("/api/profile")
      .then((payload) => {
        if (cancelled) return;
        setView(payload);
        // Tell Vox where this device is, so the overnight update runs while
        // you sleep rather than in the middle of your day.
        const zone = deviceTimeZone();
        if (zone && (!payload.timeZoneKnown || payload.timeZone !== zone)) {
          void send("/api/profile", { method: "PATCH", body: JSON.stringify({ timeZone: zone }) }).catch(() => undefined);
        }
      })
      .catch((failure) => {
        if (!cancelled) setError(failure instanceof Error ? failure.message : "Couldn’t load this.");
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [send]);

  async function updateNow() {
    setUpdating(true);
    setError("");
    try {
      const payload = await send("/api/profile/consolidate", { method: "POST" });
      setView(payload);
      toast.success(payload.messages ? "Vox is up to date" : "Nothing new to add yet");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn’t update. Try again later.");
    } finally {
      setUpdating(false);
    }
  }

  async function removeFact(id: string) {
    setRemoving(id);
    setError("");
    try {
      setView(await send("/api/profile", { method: "PATCH", body: JSON.stringify({ remove: id }) }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn’t remove that.");
    } finally {
      setRemoving(null);
    }
  }

  async function eraseEverything() {
    setErasing(true);
    setError("");
    try {
      setView(await send("/api/profile", { method: "DELETE" }));
      setConfirmingErase(false);
      toast.success("Erased");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn’t erase it.");
    } finally {
      setErasing(false);
    }
  }

  const hasContent = Boolean(view && (view.sections.length > 0 || view.digest));
  const busy = updating || erasing || view?.status === "updating";
  const updated = describeUpdated(view?.updatedAt ?? null);
  const statusLine = updating || view?.status === "updating"
    ? "Updating… this can take a minute"
    : view?.status === "error"
      ? [updated, "The last update didn’t finish. Vox will try again tonight."].filter(Boolean).join(" · ")
      : updated || "Not built yet";

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4" aria-labelledby="profile-card-title">
      <div className="flex items-start gap-3">
        <MoonStar className="mt-0.5 size-4 shrink-0 text-[#78ebff]" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 id="profile-card-title" className="text-sm font-medium text-white">
            What Vox knows about you
          </h3>
          <p className="mt-1 text-xs leading-5 text-white/55" aria-live="polite">
            {loaded ? statusLine : "Loading…"}
          </p>
        </div>
        <button
          type="button"
          className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-white/10 px-3 text-xs font-medium text-white hover:bg-white/10 disabled:opacity-50"
          disabled={!loaded || busy || !view}
          onClick={() => void updateNow()}
        >
          <RefreshCw className={`size-3.5 ${updating ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
          Update now
        </button>
      </div>

      {error && (
        <p className="mt-3 text-xs text-[#ffaaa4]" role="alert">
          {error}
        </p>
      )}

      {loaded && view && !hasContent && (
        <p className="mt-4 text-sm leading-6 text-white/55">
          Nothing here yet. Vox builds this overnight from the day’s conversations, using only what
          you said yourself. Passwords, codes, and card or ID numbers are never kept.
        </p>
      )}

      {view?.digest && (
        <div className="mt-4 rounded-xl border border-white/8 px-3.5 py-3">
          <h4 className="text-xs font-semibold text-white/55">{describeDay(view.digest.day)}</h4>
          <p className="mt-1 text-sm leading-6 text-white/80">{view.digest.text}</p>
        </div>
      )}

      {view?.sections.map((section) => (
        <div key={section.id} className="mt-4">
          <h4 className="mb-1 text-xs font-semibold text-white/55">{section.label}</h4>
          <ul>
            {section.facts.map((fact) => (
              <li key={fact.id} className="flex items-start gap-2 border-white/8 py-2 [&:not(:first-child)]:border-t">
                <p className="min-w-0 flex-1 break-words text-sm leading-6 text-white" title={`Last confirmed ${fact.confirmedAt}`}>
                  {fact.text}
                </p>
                <button
                  type="button"
                  className="-mr-1.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full text-white/40 hover:bg-white/10 hover:text-white disabled:opacity-50"
                  aria-label={`Remove: ${fact.text}`}
                  title="Remove"
                  disabled={busy || removing !== null}
                  onClick={() => void removeFact(fact.id)}
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {hasContent && (
        <div className="mt-4 border-t border-white/8 pt-3">
          {confirmingErase ? (
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Erase everything">
              <p className="min-w-0 flex-1 basis-48 text-xs leading-5 text-white/55">
                Erase everything Vox has learned about you? This can’t be undone.
              </p>
              <button
                type="button"
                className="inline-flex min-h-9 items-center rounded-full border border-white/10 px-3 text-xs font-medium text-white hover:bg-white/10 disabled:opacity-50"
                disabled={erasing}
                onClick={() => setConfirmingErase(false)}
              >
                Keep it
              </button>
              <button
                type="button"
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[#ff766c]/40 px-3 text-xs font-medium text-[#ffaaa4] hover:bg-[#ff766c]/10 disabled:opacity-50"
                disabled={erasing}
                onClick={() => void eraseEverything()}
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
                {erasing ? "Erasing…" : "Erase"}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs text-[#ffaaa4] hover:bg-[#ff766c]/10 disabled:opacity-50"
              disabled={busy}
              onClick={() => setConfirmingErase(true)}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              Erase everything
            </button>
          )}
        </div>
      )}
    </section>
  );
}
