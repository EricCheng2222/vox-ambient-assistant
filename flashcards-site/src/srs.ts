export type FlashcardRating = "again" | "hard" | "good" | "easy";

type ReviewState = { ease: number; intervalDays: number; reps: number; lapses: number };
export type FlashcardSchedule = ReviewState & { dueAt: string };

export const FLASHCARD_LIMITS = {
  deckName: 80,
  deckDescription: 300,
  front: 500,
  back: 1_000,
  notes: 1_000,
  cardsPerAdd: 100,
  decksPerOwner: 200,
  cardsPerOwner: 10_000,
} as const;

const DAY_MS = 24 * 60 * 60_000;
// A missed card returns later in the same study session.
const RELEARN_DELAY_MS = 60_000;
const MIN_EASE = 1.3;
const MAX_INTERVAL_DAYS = 3_650;

export function isFlashcardRating(value: unknown): value is FlashcardRating {
  return value === "again" || value === "hard" || value === "good" || value === "easy";
}

// SM-2 style scheduling: "again" brings the card back shortly and eases it;
// passing grades grow the interval by the card's ease.
export function scheduleReview(
  card: ReviewState,
  rating: FlashcardRating,
  now = new Date(),
): FlashcardSchedule {
  let { ease, intervalDays } = card;
  const { reps, lapses } = card;
  if (rating === "again") {
    return {
      ease: Math.max(MIN_EASE, ease - 0.2),
      intervalDays: 0,
      reps: 0,
      lapses: lapses + 1,
      dueAt: new Date(now.getTime() + RELEARN_DELAY_MS).toISOString(),
    };
  }
  if (rating === "hard") {
    ease = Math.max(MIN_EASE, ease - 0.15);
    intervalDays = reps === 0 ? 1 : Math.max(1, intervalDays * 1.2);
  } else if (rating === "good") {
    intervalDays = reps === 0 ? 1 : reps === 1 ? 3 : intervalDays * ease;
  } else {
    ease += 0.15;
    intervalDays = reps === 0 ? 4 : Math.max(4, intervalDays * ease * 1.3);
  }
  intervalDays = Math.min(MAX_INTERVAL_DAYS, Math.round(intervalDays * 10) / 10);
  return {
    ease: Math.round(ease * 100) / 100,
    intervalDays,
    reps: reps + 1,
    lapses,
    dueAt: new Date(now.getTime() + intervalDays * DAY_MS).toISOString(),
  };
}

export function cleanFlashcardText(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim().slice(0, max) : "";
}
