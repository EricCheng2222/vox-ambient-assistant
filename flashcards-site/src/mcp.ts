import { FlashcardError, FlashcardStore, type StudyFocus } from "./store.ts";
import { isFlashcardRating } from "./srs.ts";

// A stateless Model Context Protocol server (Streamable HTTP, JSON responses)
// exposing one owner's flash cards as tools.

export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

export const FLASHCARD_SERVER_INSTRUCTIONS =
  "Vox Flash Cards. Decks hold cards with a front (prompt) and a back (answer). To study: call next_card, ask the user the front without revealing the back, let them answer, then compare their answer with the back, tell them how they did, and call grade_card with again (wrong or blank), hard (right after real effort or a hint), good (right), or easy (instant and certain). If the user says how hard it felt, use their rating. Record every card as soon as the user has answered it and before asking another: a card that is not graded is not counted as reviewed and stays due. grade_card and skip_card return the next card, so ask it directly. Never quiz from list_cards, which is for browsing and editing and records nothing. The server keeps one active card per account. Repeated next_card calls resume that same card until you grade or skip it. Pass its review_id with grade_card or skip_card. Never grade before the user answers, and skip only when the user asks. Use skip_card once when the user wants to skip. Pass focus hard to work on the cards they forget most. Repeat until no cards are due. Cards the user misses come back later in the session. Use add_cards, edit_card, and delete_card to manage cards; every deck argument accepts a deck id or a deck name.";

const deckArgument = {
  type: "string",
  description: "Deck id or deck name.",
};
const focusArgument = {
  type: "string",
  enum: ["due", "hard"],
  description: "due (default): in due order. hard: the cards the user forgets most often first, for when they want to work on hard cards.",
};

function studyFocus(value: unknown): StudyFocus {
  return value === "hard" ? "hard" : "due";
}

export const FLASHCARD_TOOLS = [
  {
    name: "list_decks",
    description: "List flash-card decks with card counts and how many cards are due now.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "create_deck",
    description: "Create a deck. Returns the existing deck if one already has that name.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" }, description: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "update_deck",
    description: "Rename a deck or change its description.",
    inputSchema: {
      type: "object",
      properties: { deck: deckArgument, name: { type: "string" }, description: { type: "string" } },
      required: ["deck"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_deck",
    description: "Delete a deck and all of its cards. Confirm with the user first.",
    inputSchema: {
      type: "object",
      properties: { deck: deckArgument },
      required: ["deck"],
      additionalProperties: false,
    },
    annotations: { destructiveHint: true },
  },
  {
    name: "list_cards",
    description: "List or search cards, optionally within one deck. For browsing and editing only: it records nothing, so to quiz the user use next_card and grade_card.",
    inputSchema: {
      type: "object",
      properties: {
        deck: deckArgument,
        query: { type: "string", description: "Text to match on the front, back, or notes." },
        limit: { type: "integer", minimum: 1, maximum: 200 },
        offset: { type: "integer", minimum: 0 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "add_cards",
    description: "Add one or more cards to a deck. The deck is created if it does not exist.",
    inputSchema: {
      type: "object",
      properties: {
        deck: deckArgument,
        cards: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: {
            type: "object",
            properties: {
              front: { type: "string", description: "The prompt or question." },
              back: { type: "string", description: "The answer." },
              notes: { type: "string", description: "Optional hint, example, or mnemonic." },
            },
            required: ["front", "back"],
            additionalProperties: false,
          },
        },
      },
      required: ["deck", "cards"],
      additionalProperties: false,
    },
  },
  {
    name: "edit_card",
    description: "Change a card's front, back, or notes, or move it to another deck.",
    inputSchema: {
      type: "object",
      properties: {
        card_id: { type: "string" },
        front: { type: "string" },
        back: { type: "string" },
        notes: { type: "string" },
        move_to_deck: deckArgument,
      },
      required: ["card_id"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_card",
    description: "Delete one card.",
    inputSchema: {
      type: "object",
      properties: { card_id: { type: "string" } },
      required: ["card_id"],
      additionalProperties: false,
    },
    annotations: { destructiveHint: true },
  },
  {
    name: "next_card",
    description: "Get or resume the single active card. Another card is unavailable until this one is graded or skipped. Ask the front; keep the back hidden until the user answers.",
    inputSchema: {
      type: "object",
      properties: { deck: deckArgument, focus: focusArgument },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "grade_card",
    description: "Record how the user did on a card and schedule its next review. Returns the next card to ask, so don't call next_card afterwards.",
    inputSchema: {
      type: "object",
      properties: {
        deck: deckArgument,
        focus: focusArgument,
        card_id: { type: "string" },
        review_id: { type: "string", description: "The active card’s review_id returned by next_card." },
        rating: {
          type: "string",
          enum: ["again", "hard", "good", "easy"],
          description: "again: wrong or no answer; hard: right with effort or a hint; good: right; easy: instant.",
        },
      },
      required: ["card_id", "review_id", "rating"],
      additionalProperties: false,
    },
    // Writes, but nothing is lost and nothing leaves this account.
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "grade_cards",
    description:
      "Compatibility alias for grading the single active card. Supply exactly one review and its review_id; bulk grading is not allowed. Prefer grade_card.",
    inputSchema: {
      type: "object",
      properties: {
        deck: deckArgument,
        focus: focusArgument,
        review_id: { type: "string", description: "The active card’s review_id." },
        reviews: {
          type: "array",
          minItems: 1,
          maxItems: 1,
          items: {
            type: "object",
            properties: {
              card_id: { type: "string" },
              rating: { type: "string", enum: ["again", "hard", "good", "easy"] },
            },
            required: ["card_id", "rating"],
            additionalProperties: false,
          },
        },
      },
      required: ["reviews", "review_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "skip_card",
    description: "Skip a card for now without grading it: it moves to the end of today's due cards. Returns the next card to ask, so don't call next_card afterwards. Call it once per skip request.",
    inputSchema: {
      type: "object",
      properties: { card_id: { type: "string" }, review_id: { type: "string", description: "The active card’s review_id." }, deck: deckArgument, focus: focusArgument },
      required: ["card_id", "review_id"],
      additionalProperties: false,
    },
  },
  {
    name: "study_stats",
    description: "Summarize progress: total cards, due now, new cards, and reviews in the last 24 hours.",
    inputSchema: {
      type: "object",
      properties: { deck: deckArgument },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
] as const;

type JsonRpcId = string | number | null;
export type JsonRpcMessage = { jsonrpc?: unknown; id?: JsonRpcId; method?: unknown; params?: unknown };

function rpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function text(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

export async function callTool(store: FlashcardStore, name: string, args: Record<string, unknown>) {
  const nextCard = async (deckId: string | undefined, focus: StudyFocus, skippedId?: string) => {
    const next = await store.nextStudyCard(deckId, new Date(), focus);
    if (!next.card) return { done: true, message: "No cards are due right now.", next_due_at: next.nextDueAt ?? null };
    const { card } = next;
    return {
      card: { card_id: card.id, review_id: next.reviewId, deck_id: card.deckId, front: card.front, back: card.back, notes: card.notes, reviews: card.reps, lapses: card.lapses },
      due_remaining: next.dueRemaining,
      ...(next.repeat ? { repeat: "The user missed this card earlier today; it's back for another try." } : {}),
      ...(skippedId && card.id === skippedId ? { only_card_left: true } : {}),
      reminder: "Ask the front only. Reveal the back after the user answers, then call grade_card with this card_id and review_id: until you do, the review is not recorded. Only skip if the user asks.",
    };
  };
  const optionalDeckId = async (ref: unknown) => (text(ref)?.trim() ? (await store.requireDeck(ref)).id : undefined);
  switch (name) {
    case "list_decks":
      return { decks: await store.listDecks() };
    case "create_deck":
      return { deck: await store.createDeck(args.name, args.description) };
    case "update_deck": {
      const deck = await store.requireDeck(args.deck);
      return { deck: await store.updateDeck(deck.id, { name: args.name, description: args.description }) };
    }
    case "delete_deck": {
      const deck = await store.requireDeck(args.deck);
      return { deleted: await store.deleteDeck(deck.id) };
    }
    case "list_cards":
      return {
        cards: await store.listCards({
          deckId: await optionalDeckId(args.deck),
          query: text(args.query),
          limit: typeof args.limit === "number" ? args.limit : undefined,
          offset: typeof args.offset === "number" ? args.offset : undefined,
        }),
      };
    case "add_cards": {
      const ref = text(args.deck)?.trim() ?? "";
      if (!ref) throw new FlashcardError("Say which deck to use.");
      const deck = (await store.findDeck(ref)) ?? (await store.createDeck(ref));
      const cards = Array.isArray(args.cards) ? (args.cards as Array<Record<string, unknown>>) : [];
      return { deck: deck.name, added: await store.addCards(deck.id, cards) };
    }
    case "edit_card":
      return {
        card: await store.updateCard(text(args.card_id) ?? "", {
          front: args.front,
          back: args.back,
          notes: args.notes,
          deckId: await optionalDeckId(args.move_to_deck),
        }),
      };
    case "delete_card":
      return { deleted: await store.deleteCard(text(args.card_id) ?? "") };
    case "next_card":
      return nextCard(await optionalDeckId(args.deck), studyFocus(args.focus));
    case "skip_card": {
      const resolved = await store.resolveStudyCard(text(args.card_id) ?? "", text(args.review_id) ?? "", "skip");
      const next = await nextCard(args.deck === undefined ? resolved.deckId : await optionalDeckId(args.deck), args.focus === undefined ? resolved.focus : studyFocus(args.focus), resolved.card.id);
      return { skipped: resolved.card.id, next };
    }
    case "grade_card": {
      if (!isFlashcardRating(args.rating)) throw new FlashcardError("Rating must be again, hard, good, or easy.");
      const resolved = await store.resolveStudyCard(text(args.card_id) ?? "", text(args.review_id) ?? "", args.rating);
      const next = await nextCard(args.deck === undefined ? resolved.deckId : await optionalDeckId(args.deck), args.focus === undefined ? resolved.focus : studyFocus(args.focus));
      return { graded: { card_id: resolved.card.id, rating: args.rating, next_due_at: resolved.card.dueAt }, next };
    }
    case "grade_cards": {
      const reviews = Array.isArray(args.reviews) ? args.reviews as Array<Record<string, unknown>> : [];
      if (reviews.length !== 1) throw new FlashcardError("Grade exactly one active card at a time, or explicitly skip it. Bulk grading is not allowed.");
      const review = reviews[0];
      if (!isFlashcardRating(review?.rating)) throw new FlashcardError("Rating must be again, hard, good, or easy.");
      const resolved = await store.resolveStudyCard(text(review.card_id) ?? "", text(args.review_id) ?? "", review.rating);
      return { graded: [{ card_id: resolved.card.id, rating: review.rating, next_due_at: resolved.card.dueAt }], next: await nextCard(args.deck === undefined ? resolved.deckId : await optionalDeckId(args.deck), args.focus === undefined ? resolved.focus : studyFocus(args.focus)) };
    }
    case "study_stats":
      return { stats: await store.stats(await optionalDeckId(args.deck)) };
    default:
      return undefined;
  }
}

/** Handles one JSON-RPC message; returns null for notifications. */
export async function handleMcpMessage(store: FlashcardStore, message: JsonRpcMessage) {
  const id = message.id ?? null;
  const isNotification = message.id === undefined;
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return isNotification ? null : rpcError(id, -32600, "Invalid request.");
  }
  const params = (message.params && typeof message.params === "object" ? message.params : {}) as Record<string, unknown>;
  switch (message.method) {
    case "initialize": {
      const requested = text(params.protocolVersion);
      return rpcResult(id, {
        protocolVersion: requested && MCP_PROTOCOL_VERSIONS.includes(requested) ? requested : MCP_PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "vox-flashcards", title: "Vox Flash Cards", version: "1.0.0" },
        instructions: FLASHCARD_SERVER_INSTRUCTIONS,
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: FLASHCARD_TOOLS });
    case "tools/call": {
      const name = text(params.name) ?? "";
      const args = (params.arguments && typeof params.arguments === "object" ? params.arguments : {}) as Record<string, unknown>;
      try {
        const result = await callTool(store, name, args);
        if (result === undefined) return rpcError(id, -32602, `Unknown tool: ${name}`);
        return rpcResult(id, { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result, isError: false });
      } catch (error) {
        if (!(error instanceof FlashcardError)) console.error("Flash-card tool failed", name, error);
        return rpcResult(id, {
          content: [{ type: "text", text: error instanceof FlashcardError ? error.message : "That flash-card action could not be completed." }],
          isError: true,
        });
      }
    }
    default:
      if (message.method.startsWith("notifications/")) return null;
      return isNotification ? null : rpcError(id, -32601, `Method not found: ${message.method}`);
  }
}
