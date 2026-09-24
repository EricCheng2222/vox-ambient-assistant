export type ReminderStatus = "pending" | "completed" | "dismissed";

export type ReminderDelivery = "app" | "call";

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
