// What GET /api/today returns: the parts of the Today briefing that live on
// other services (email, flash cards). Reminders, files, Mac tasks, and
// pending approvals come from the page's own state.

export type TodayMail = {
  connected: boolean;
  /** Set when connected but the mail server could not be read. */
  error?: string;
  accounts: string[];
  unreadCount: number | null;
  /** The newest unread messages worth a look, newest first, at most 5. */
  unread: Array<{ id: string; from: string; subject: string; account: string; date: string | null }>;
};

export type TodayFlashcards = {
  connected: boolean;
  error?: string;
  decks: Array<{ id: string; title: string; due: number }>;
  totalDue: number | null;
};

export type TodayBriefing = {
  mail: TodayMail;
  flashcards: TodayFlashcards;
  generatedAt: string;
};
