import {
  formatProfileContext,
  PROFILE_SECTIONS,
  profileSectionLabels,
  type OwnerProfile,
  type ProfileSection,
} from "./profile.ts";
import { MANUAL_RUN_INTERVAL_MS } from "./profile-consolidate.ts";
import { resolveTimeZone } from "./profile-schedule.ts";

// What /api/profile sends to the page. The list of forgotten things stays on
// the server.

export type ProfileView = {
  sections: Array<{
    id: ProfileSection;
    label: string;
    facts: Array<{ id: string; text: string; confirmedAt: string }>;
  }>;
  digest: { day: string; text: string } | null;
  /** When the profile was last brought up to date, or null if never. */
  updatedAt: string | null;
  status: "empty" | "ready" | "updating" | "error";
  lastRun: { at: string; status: "ok" | "error"; trigger: "nightly" | "manual"; messages: number } | null;
  /** When "Update now" may be used again (ISO), or null when it may be now. */
  canUpdateAt: string | null;
  timeZone: string;
  /** False until a device has told Vox its time zone. */
  timeZoneKnown: boolean;
  /** The profile as the model sees it, for the page's live voice session. */
  context: string;
};

export function profileResponse(
  overview: {
    profile: OwnerProfile;
    timeZone: string | null;
    timeZoneSource: string | null;
    updatedAt: string | null;
    running: boolean;
    manualRunAt: string | null;
    lastRun: { at: string; status: "ok" | "error"; trigger: "nightly" | "manual"; messages: number } | null;
  },
  options: { alreadyKnown?: string[]; now?: Date } = {},
): ProfileView {
  const { profile } = overview;
  const now = options.now ?? new Date();
  const nextManual = overview.manualRunAt ? Date.parse(overview.manualRunAt) + MANUAL_RUN_INTERVAL_MS : 0;
  const hasContent = profile.facts.length > 0 || Boolean(profile.digest);
  return {
    sections: PROFILE_SECTIONS.map((section) => ({
      id: section,
      label: profileSectionLabels[section],
      facts: profile.facts
        .filter((fact) => fact.section === section)
        .sort((left, right) => right.confirmedAt.localeCompare(left.confirmedAt))
        .map((fact) => ({ id: fact.id, text: fact.text, confirmedAt: fact.confirmedAt })),
    })).filter((section) => section.facts.length > 0),
    digest: profile.digest,
    updatedAt: overview.updatedAt,
    status: overview.running
      ? "updating"
      : overview.lastRun?.status === "error"
        ? "error"
        : hasContent
          ? "ready"
          : "empty",
    lastRun: overview.lastRun
      ? {
          at: overview.lastRun.at,
          status: overview.lastRun.status,
          trigger: overview.lastRun.trigger,
          messages: overview.lastRun.messages,
        }
      : null,
    canUpdateAt: nextManual > now.getTime() ? new Date(nextManual).toISOString() : null,
    timeZone: resolveTimeZone(overview.timeZone),
    timeZoneKnown: overview.timeZoneSource === "device",
    context: formatProfileContext(profile, { alreadyKnown: options.alreadyKnown }),
  };
}

export function profileStorageError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return message.includes("no such table") || message.includes("user_profiles")
    ? "Vox isn’t ready to keep a profile yet."
    : "Your profile is temporarily unavailable.";
}
