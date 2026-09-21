export const USER_TIME_ZONE = "Asia/Taipei";

export function getCurrentTimeContext(now = new Date()) {
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone: USER_TIME_ZONE,
    dateStyle: "full",
    timeStyle: "long",
    hourCycle: "h23",
  }).format(now);

  return `## Authoritative clock\nCurrent UTC time: ${now.toISOString()}\nCurrent user-local date and time: ${local}\nIANA time zone: ${USER_TIME_ZONE} (Taiwan, UTC+08:00). Use this clock for questions about the current time, date, weekday, today, tomorrow, yesterday, deadlines, and relative dates. Do not say you lack access to the time or date.`;
}
