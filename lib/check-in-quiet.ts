// Notices the user has put off or switched off, kept on the device.
// "Later" hides one for a few hours; "Don't show again" hides it for good.
// A notice is known by its id: a kind of notice for the standing ones
// ("check:study" is every flash-card nudge), one particular thing for the rest
// (an invitation, an email).

export const QUIET_STORAGE_KEY = "vox:check-in-quiet";
/** How long "Later" puts a notice off. */
export const LATER_MS = 3 * 60 * 60_000;

export type QuietNotices = { never: string[]; later: Record<string, number> };

const MAX_NEVER = 200;

/** Reads what was stored; anything malformed starts empty. Notices whose "later" has passed are dropped. */
export function readQuiet(stored: string | null | undefined, now: number): QuietNotices {
  let value: unknown = null;
  try {
    value = stored ? JSON.parse(stored) : null;
  } catch {
    value = null;
  }
  const record = (value && typeof value === "object" ? value : {}) as { never?: unknown; later?: unknown };
  const never = Array.isArray(record.never) ? record.never.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 200).slice(-MAX_NEVER) : [];
  const later: Record<string, number> = {};
  if (record.later && typeof record.later === "object") {
    for (const [id, until] of Object.entries(record.later as Record<string, unknown>)) {
      if (typeof until === "number" && Number.isFinite(until) && until > now && id.length <= 200) later[id] = until;
    }
  }
  return { never, later };
}

/** The same notice under the name Vox uses when it raises it aloud, so it is not brought up that way either. */
const names = (id: string) => [...new Set([id, id.replace(/^check:/u, "")])];

export function putOff(quiet: QuietNotices, id: string, now: number): QuietNotices {
  const later = { ...quiet.later };
  for (const name of names(id)) later[name] = now + LATER_MS;
  return { never: quiet.never, later };
}

export function neverAgain(quiet: QuietNotices, id: string): QuietNotices {
  const later = { ...quiet.later };
  for (const name of names(id)) delete later[name];
  return { never: [...new Set([...quiet.never, ...names(id)])].slice(-MAX_NEVER), later };
}

/** Every notice that must stay out of sight right now. */
export function quietIds(quiet: QuietNotices): string[] {
  return [...quiet.never, ...Object.keys(quiet.later)];
}
