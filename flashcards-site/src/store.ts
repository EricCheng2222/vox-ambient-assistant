import { cleanFlashcardText, FLASHCARD_LIMITS, scheduleReview, type FlashcardRating } from "./srs.ts";
import { now } from "./util.ts";

export class FlashcardError extends Error {}

export type Deck = {
  id: string;
  name: string;
  description: string | null;
  cardCount: number;
  dueCount: number;
  createdAt: string;
  updatedAt: string;
};

export type Card = {
  id: string;
  deckId: string;
  front: string;
  back: string;
  notes: string | null;
  ease: number;
  intervalDays: number;
  reps: number;
  lapses: number;
  dueAt: string;
  lastReviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const cardColumns =
  "id, deck_id AS deckId, front, back, notes, ease, interval_days AS intervalDays, reps, lapses, due_at AS dueAt, last_reviewed_at AS lastReviewedAt, created_at AS createdAt, updated_at AS updatedAt";

export class FlashcardStore {
  private readonly db: D1Database;
  private readonly ownerId: string;

  constructor(db: D1Database, ownerId: string) {
    this.db = db;
    this.ownerId = ownerId;
  }

  async listDecks(): Promise<Deck[]> {
    const { results } = await this.db
      .prepare(
        `SELECT d.id, d.name, d.description, d.created_at AS createdAt, d.updated_at AS updatedAt,
           (SELECT count(*) FROM cards c WHERE c.owner_id = d.owner_id AND c.deck_id = d.id) AS cardCount,
           (SELECT count(*) FROM cards c WHERE c.owner_id = d.owner_id AND c.deck_id = d.id AND c.due_at <= ?2) AS dueCount
         FROM decks d WHERE d.owner_id = ?1 ORDER BY d.name COLLATE NOCASE`,
      )
      .bind(this.ownerId, now())
      .all<Deck>();
    return results.map((deck) => ({ ...deck, cardCount: Number(deck.cardCount), dueCount: Number(deck.dueCount) }));
  }

  /** Finds a deck by id, or by name ignoring case. */
  async findDeck(ref: string) {
    const value = ref.trim();
    if (!value) return null;
    const decks = await this.listDecks();
    return decks.find((deck) => deck.id === value) ??
      decks.find((deck) => deck.name.toLocaleLowerCase() === value.toLocaleLowerCase()) ??
      null;
  }

  async requireDeck(ref: unknown) {
    const value = typeof ref === "string" ? ref : "";
    if (!value.trim()) throw new FlashcardError("Say which deck to use.");
    const deck = await this.findDeck(value);
    if (!deck) throw new FlashcardError(`There is no deck called “${value.trim()}”.`);
    return deck;
  }

  async createDeck(rawName: unknown, rawDescription?: unknown) {
    const name = cleanFlashcardText(rawName, FLASHCARD_LIMITS.deckName);
    if (!name) throw new FlashcardError("A deck needs a name.");
    const existing = await this.findDeck(name);
    if (existing && existing.name.toLocaleLowerCase() === name.toLocaleLowerCase()) return existing;
    if ((await this.listDecks()).length >= FLASHCARD_LIMITS.decksPerOwner) {
      throw new FlashcardError("You have reached the deck limit.");
    }
    const id = crypto.randomUUID();
    const stamp = now();
    await this.db
      .prepare("INSERT INTO decks (id, owner_id, name, description, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)")
      .bind(id, this.ownerId, name, cleanFlashcardText(rawDescription, FLASHCARD_LIMITS.deckDescription) || null, stamp)
      .run();
    return (await this.findDeck(id))!;
  }

  async updateDeck(deckId: string, change: { name?: unknown; description?: unknown }) {
    const name = change.name === undefined ? undefined : cleanFlashcardText(change.name, FLASHCARD_LIMITS.deckName);
    if (name === "") throw new FlashcardError("A deck needs a name.");
    if (name) {
      const clash = await this.findDeck(name);
      if (clash && clash.id !== deckId && clash.name.toLocaleLowerCase() === name.toLocaleLowerCase()) {
        throw new FlashcardError(`A deck named “${name}” already exists.`);
      }
    }
    const description = change.description === undefined
      ? undefined
      : cleanFlashcardText(change.description, FLASHCARD_LIMITS.deckDescription) || null;
    const result = await this.db
      .prepare(
        `UPDATE decks SET name = COALESCE(?3, name),
           description = CASE WHEN ?4 THEN ?5 ELSE description END, updated_at = ?6
         WHERE owner_id = ?1 AND id = ?2`,
      )
      .bind(this.ownerId, deckId, name ?? null, description !== undefined ? 1 : 0, description ?? null, now())
      .run();
    if (!result.meta.changes) throw new FlashcardError("That deck was not found.");
    return (await this.findDeck(deckId))!;
  }

  async deleteDeck(deckId: string) {
    const deck = await this.findDeck(deckId);
    if (!deck || deck.id !== deckId) throw new FlashcardError("That deck was not found.");
    await this.db.batch([
      this.db.prepare("DELETE FROM cards WHERE owner_id = ?1 AND deck_id = ?2").bind(this.ownerId, deckId),
      this.db.prepare("DELETE FROM decks WHERE owner_id = ?1 AND id = ?2").bind(this.ownerId, deckId),
    ]);
    return { id: deck.id, name: deck.name };
  }

  async listCards(options: { deckId?: string; query?: string; limit?: number; offset?: number } = {}) {
    const limit = Math.min(200, Math.max(1, Math.floor(options.limit ?? 50)));
    const offset = Math.max(0, Math.floor(options.offset ?? 0));
    const query = options.query?.trim().slice(0, 100);
    const pattern = query ? `%${query.replace(/[%_\\]/g, (character) => `\\${character}`)}%` : null;
    const { results } = await this.db
      .prepare(
        `SELECT ${cardColumns} FROM cards
         WHERE owner_id = ?1 AND (?2 IS NULL OR deck_id = ?2)
           AND (?3 IS NULL OR front LIKE ?3 ESCAPE '\\' OR back LIKE ?3 ESCAPE '\\' OR notes LIKE ?3 ESCAPE '\\')
         ORDER BY created_at LIMIT ?4 OFFSET ?5`,
      )
      .bind(this.ownerId, options.deckId ?? null, pattern, limit, offset)
      .all<Card>();
    return results;
  }

  private async card(cardId: string) {
    const card = await this.db
      .prepare(`SELECT ${cardColumns} FROM cards WHERE owner_id = ?1 AND id = ?2`)
      .bind(this.ownerId, cardId)
      .first<Card>();
    if (!card) throw new FlashcardError("That card was not found.");
    return card;
  }

  async addCards(deckId: string, input: Array<Record<string, unknown>>) {
    const cards = input.slice(0, FLASHCARD_LIMITS.cardsPerAdd).map((card) => ({
      front: cleanFlashcardText(card.front, FLASHCARD_LIMITS.front),
      back: cleanFlashcardText(card.back, FLASHCARD_LIMITS.back),
      notes: cleanFlashcardText(card.notes, FLASHCARD_LIMITS.notes) || null,
    }));
    if (!cards.length || cards.some((card) => !card.front || !card.back)) {
      throw new FlashcardError("Every card needs a front and a back.");
    }
    const count = await this.db
      .prepare("SELECT count(*) AS n FROM cards WHERE owner_id = ?1")
      .bind(this.ownerId)
      .first<{ n: number }>();
    if (Number(count?.n ?? 0) + cards.length > FLASHCARD_LIMITS.cardsPerOwner) {
      throw new FlashcardError("You have reached the card limit.");
    }
    const stamp = now();
    const rows = cards.map((card) => ({ id: crypto.randomUUID(), ...card }));
    await this.db.batch(
      rows.map((row) =>
        this.db
          .prepare(
            "INSERT INTO cards (id, owner_id, deck_id, front, back, notes, due_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?7)",
          )
          .bind(row.id, this.ownerId, deckId, row.front, row.back, row.notes, stamp),
      ),
    );
    return rows.map((row) => ({ ...row, deckId }));
  }

  async updateCard(cardId: string, change: { front?: unknown; back?: unknown; notes?: unknown; deckId?: string }) {
    await this.card(cardId);
    const front = change.front === undefined ? null : cleanFlashcardText(change.front, FLASHCARD_LIMITS.front);
    const back = change.back === undefined ? null : cleanFlashcardText(change.back, FLASHCARD_LIMITS.back);
    if (front === "" || back === "") throw new FlashcardError("A card needs a front and a back.");
    const notes = change.notes === undefined ? undefined : cleanFlashcardText(change.notes, FLASHCARD_LIMITS.notes) || null;
    await this.db
      .prepare(
        `UPDATE cards SET front = COALESCE(?3, front), back = COALESCE(?4, back),
           notes = CASE WHEN ?5 THEN ?6 ELSE notes END, deck_id = COALESCE(?7, deck_id), updated_at = ?8
         WHERE owner_id = ?1 AND id = ?2`,
      )
      .bind(this.ownerId, cardId, front, back, notes !== undefined ? 1 : 0, notes ?? null, change.deckId ?? null, now())
      .run();
    return this.card(cardId);
  }

  async deleteCard(cardId: string) {
    const card = await this.card(cardId);
    await this.db.prepare("DELETE FROM cards WHERE owner_id = ?1 AND id = ?2").bind(this.ownerId, cardId).run();
    return { id: card.id, front: card.front };
  }

  async nextDueCard(deckId?: string, at = new Date()) {
    const stamp = at.toISOString();
    const card = await this.db
      .prepare(
        `SELECT ${cardColumns} FROM cards WHERE owner_id = ?1 AND (?2 IS NULL OR deck_id = ?2) AND due_at <= ?3
         ORDER BY due_at LIMIT 1`,
      )
      .bind(this.ownerId, deckId ?? null, stamp)
      .first<Card>();
    if (card) {
      const due = await this.db
        .prepare("SELECT count(*) AS n FROM cards WHERE owner_id = ?1 AND (?2 IS NULL OR deck_id = ?2) AND due_at <= ?3")
        .bind(this.ownerId, deckId ?? null, stamp)
        .first<{ n: number }>();
      return { card, dueRemaining: Number(due?.n ?? 0) };
    }
    const upcoming = await this.db
      .prepare("SELECT due_at AS dueAt FROM cards WHERE owner_id = ?1 AND (?2 IS NULL OR deck_id = ?2) AND due_at > ?3 ORDER BY due_at LIMIT 1")
      .bind(this.ownerId, deckId ?? null, stamp)
      .first<{ dueAt: string }>();
    return { card: null, dueRemaining: 0, nextDueAt: upcoming?.dueAt ?? null };
  }

  async gradeCard(cardId: string, rating: FlashcardRating, at = new Date()) {
    const card = await this.card(cardId);
    const schedule = scheduleReview(card, rating, at);
    await this.db
      .prepare(
        `UPDATE cards SET ease = ?3, interval_days = ?4, reps = ?5, lapses = ?6, due_at = ?7,
           last_reviewed_at = ?8, updated_at = ?8 WHERE owner_id = ?1 AND id = ?2`,
      )
      .bind(this.ownerId, cardId, schedule.ease, schedule.intervalDays, schedule.reps, schedule.lapses, schedule.dueAt, at.toISOString())
      .run();
    return { ...card, ...schedule };
  }

  async stats(deckId?: string, at = new Date()) {
    const row = await this.db
      .prepare(
        `SELECT count(*) AS total,
           sum(CASE WHEN due_at <= ?3 THEN 1 ELSE 0 END) AS due,
           sum(CASE WHEN reps = 0 AND last_reviewed_at IS NULL THEN 1 ELSE 0 END) AS fresh,
           sum(CASE WHEN last_reviewed_at >= ?4 THEN 1 ELSE 0 END) AS reviewed,
           sum(lapses) AS lapses
         FROM cards WHERE owner_id = ?1 AND (?2 IS NULL OR deck_id = ?2)`,
      )
      .bind(this.ownerId, deckId ?? null, at.toISOString(), new Date(at.getTime() - 86_400_000).toISOString())
      .first<Record<string, number | null>>();
    return {
      totalCards: Number(row?.total ?? 0),
      dueNow: Number(row?.due ?? 0),
      newCards: Number(row?.fresh ?? 0),
      reviewedLast24h: Number(row?.reviewed ?? 0),
      totalLapses: Number(row?.lapses ?? 0),
    };
  }
}
