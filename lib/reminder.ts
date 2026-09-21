export type ReminderStatus = "pending" | "completed" | "dismissed";

export type Reminder = {
  id: string;
  title: string;
  notes: string | null;
  dueAt: string;
  status: ReminderStatus;
  source: string;
  notifiedAt: string | null;
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
