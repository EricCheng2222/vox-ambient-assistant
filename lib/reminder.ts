export type ReminderStatus = "pending" | "completed" | "dismissed";

export type ReminderDelivery = "app" | "call";

export type ReminderTriggerType = "time" | "location";
export type ReminderPlaceEvent = "arrive" | "leave";
// Reported by the iPhone app after it tries to arm a location reminder.
export type ReminderLocationStatus =
  | "armed"
  | "place_not_found"
  | "permission_needed"
  | "limit_reached";

// Location reminders have no due time. They carry this far-future placeholder
// so every time-based path (due alerts, calls, overdue, postpone) skips them.
export const LOCATION_REMINDER_DUE_AT = "9999-12-31T00:00:00.000Z";

// calling: a call is being placed; called: Twilio accepted it; failed: Twilio
// rejected it (retried); unavailable: calls from Vox were off when it came due;
// missed: the reminder was too old to call by the time it was reached.
export type ReminderCallStatus =
  | "calling"
  | "called"
  | "failed"
  | "unavailable"
  | "missed";

export type Reminder = {
  id: string;
  title: string;
  notes: string | null;
  dueAt: string;
  status: ReminderStatus;
  source: string;
  notifiedAt: string | null;
  delivery: ReminderDelivery;
  callStatus: ReminderCallStatus | null;
  calledAt: string | null;
  triggerType: ReminderTriggerType;
  place: string | null;
  placeEvent: ReminderPlaceEvent | null;
  locationStatus: ReminderLocationStatus | null;
  createdAt: string;
  updatedAt: string;
};

export function formatReminderTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat(undefined, {
    timeZone: "Asia/Taipei",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export type ReminderPostpone = "10m" | "1h" | "tomorrow";

export const reminderPostponeOptions: Array<{ id: ReminderPostpone; label: string }> = [
  { id: "10m", label: "10 minutes" },
  { id: "1h", label: "1 hour" },
  { id: "tomorrow", label: "Tomorrow at 9:00" },
];

const TAIPEI_OFFSET_MS = 8 * 60 * 60_000;

// New due time for a postponed reminder. "Tomorrow" is 09:00 Taiwan time,
// matching how reminder times are parsed and displayed.
export function postponedDueAt(option: ReminderPostpone, now = new Date()) {
  if (option === "10m") return new Date(now.getTime() + 10 * 60_000).toISOString();
  if (option === "1h") return new Date(now.getTime() + 60 * 60_000).toISOString();
  const taipei = new Date(now.getTime() + TAIPEI_OFFSET_MS);
  return new Date(
    Date.UTC(taipei.getUTCFullYear(), taipei.getUTCMonth(), taipei.getUTCDate() + 1, 9) -
      TAIPEI_OFFSET_MS,
  ).toISOString();
}

export function isReminderPostpone(value: unknown): value is ReminderPostpone {
  return value === "10m" || value === "1h" || value === "tomorrow";
}

export function isLocationReminder(reminder: Pick<Reminder, "triggerType">) {
  return reminder.triggerType === "location";
}

export function isReminderOverdue(
  reminder: Pick<Reminder, "status" | "dueAt" | "triggerType">,
  now = Date.now(),
) {
  return !isLocationReminder(reminder) && reminder.status === "pending" && Date.parse(reminder.dueAt) <= now;
}

// Matches the server list: finished time reminders disappear once their time
// passes; finished location reminders disappear right away.
export function isReminderVisible(
  reminder: Pick<Reminder, "status" | "dueAt" | "triggerType">,
  now = Date.now(),
) {
  if (reminder.status === "pending") return true;
  return !isLocationReminder(reminder) && Date.parse(reminder.dueAt) > now;
}

export function isReminderPlaceEvent(value: unknown): value is ReminderPlaceEvent {
  return value === "arrive" || value === "leave";
}

export function isReminderLocationStatus(value: unknown): value is ReminderLocationStatus {
  return (
    value === "armed" ||
    value === "place_not_found" ||
    value === "permission_needed" ||
    value === "limit_reached"
  );
}

export function reminderPlaceLabel(
  reminder: Pick<Reminder, "place" | "placeEvent">,
  language: "taiwan_mandarin" | "english" = "english",
) {
  const place = reminder.place ?? "";
  if (language === "taiwan_mandarin") {
    return reminder.placeEvent === "leave" ? `離開「${place}」時` : `抵達「${place}」時`;
  }
  return reminder.placeEvent === "leave" ? `When you leave ${place}` : `When you arrive at ${place}`;
}

export function isReminderDelivery(value: unknown): value is ReminderDelivery {
  return value === "app" || value === "call";
}

export type ReminderCallScript = {
  language: "zh-TW" | "en-GB";
  text: string;
};

// What Vox says when it phones the owner about a due reminder. The title and
// notes are the user's own words, spoken as data rather than interpreted.
export function reminderCallScript(
  reminder: Pick<Reminder, "title" | "notes">,
): ReminderCallScript {
  const title = reminder.title.replace(/\s+/g, " ").trim().slice(0, 180);
  const notes = reminder.notes?.replace(/\s+/g, " ").trim().slice(0, 300) ?? "";
  if (/[\u3400-\u9fff]/u.test(`${title}${notes}`)) {
    return {
      language: "zh-TW",
      text: `你好，這是 Vox 的提醒。${title}。${notes ? `${notes}。` : ""}`,
    };
  }
  return {
    language: "en-GB",
    text: `Hello, this is Vox with your reminder. ${title}.${notes ? ` ${notes}.` : ""}`,
  };
}
