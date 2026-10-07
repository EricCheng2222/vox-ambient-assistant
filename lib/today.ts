import type { MailCategory } from "./mail-category.ts";

// What GET /api/today returns: the parts of the Today briefing that live on
// other services (email, calendar, tasks, flash cards), plus `now`: the few
// things that deserve attention at this moment, chosen by JEV. Vox is meant
// to surface things at the right time, not to list everything at once.
// Files, Mac tasks, and pending approvals come from the page's own state.

export type TodayMail = {
  connected: boolean;
  /** Set when connected but the mail server could not be read. */
  error?: string;
  accounts: string[];
  unreadCount: number | null;
  /**
   * Unread messages JEV judged worth showing, most important first, at most
   * 5. Promotions, newsletters, and automated notices are left out.
   */
  unread: Array<{
    id: string;
    from: string;
    subject: string;
    account: string;
    date: string | null;
    /** "needs_you": wants a reply or action. "worth_reading": relevant, no action. */
    importance: "needs_you" | "worth_reading";
    /** What kind of email it is, when JEV could sort it. */
    category?: MailCategory;
  }>;
  /**
   * The rest of the newest unread mail: what JEV left out (promotions,
   * newsletters, notices) or that didn't fit above. Newest first, at most 15.
   * Kept one step away, never shown by default.
   */
  other?: Array<{ id: string; from: string; subject: string; account: string; date: string | null; category?: MailCategory }>;
};

export type TodayFlashcards = {
  connected: boolean;
  error?: string;
  decks: Array<{ id: string; title: string; due: number }>;
  totalDue: number | null;
};

/** Google Calendar, next 36 hours, soonest first, at most 12. */
export type TodayCalendar = {
  connected: boolean;
  /** Connected, but the Google account hasn't granted calendar access yet. */
  needsAccess?: boolean;
  error?: string;
  events: Array<{
    id: string;
    title: string;
    /** ISO date-time, or a date ("2026-10-08") for all-day events. */
    start: string;
    end: string | null;
    allDay: boolean;
    location: string | null;
    account: string;
  }>;
};

/** Google Tasks that are open and due within a week or overdue, at most 12. */
export type TodayTasks = {
  connected: boolean;
  needsAccess?: boolean;
  error?: string;
  items: Array<{ id: string; title: string; due: string | null; overdue: boolean; list: string }>;
};

/**
 * One thing worth attention right now. `id` refers to an item in the matching
 * list (mail.unread, calendar.events, tasks.items, flashcards.decks). `why`
 * is a short reason ("Starts in 40 minutes", "Asks for a reply by Friday").
 * Reminders live in the page and are merged in there.
 */
export type TodayMoment = {
  kind: "email" | "event" | "task" | "study";
  id: string;
  title: string;
  why: string;
};

export type TodayBriefing = {
  mail: TodayMail;
  flashcards: TodayFlashcards;
  calendar: TodayCalendar;
  tasks: TodayTasks;
  /** At most 4, most important first; empty when nothing needs attention. */
  now: TodayMoment[];
  generatedAt: string;
};
