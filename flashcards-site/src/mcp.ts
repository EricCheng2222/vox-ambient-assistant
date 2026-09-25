import { FlashcardError, FlashcardStore } from "./store.ts";
import { isFlashcardRating } from "./srs.ts";

// A stateless Model Context Protocol server (Streamable HTTP, JSON responses)
// exposing one owner's flash cards as tools.

export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

export const FLASHCARD_SERVER_INSTRUCTIONS =
  "Vox Flash Cards. Decks hold cards with a front (prompt) and a back (answer). To study: call next_card, ask the user the front without revealing the back, let them answer, then compare their answer with the back, tell them how they did, and call grade_card with again (wrong or blank), hard (right after real effort or a hint), good (right), or easy (instant and certain). Repeat until next_card reports no cards are due. Cards the user misses come back later in the session. Use add_cards, edit_card, and delete_card to manage cards; every deck argument accepts a deck id or a deck name.";

const deckArgument = {
  type: "string",
  description: "Deck id or deck name.",
};

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
    description: "List or search cards, optionally within one deck.",
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
    description: "Get the next card due for review. Ask the user the front; keep the back hidden until they answer.",
    inputSchema: {
      type: "object",
      properties: { deck: deckArgument },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "grade_card",
    description: "Record how the user did on a card and schedule its next review.",
    inputSchema: {
      type: "object",
      properties: {
        card_id: { type: "string" },
        rating: {
          type: "string",
          enum: ["again", "hard", "good", "easy"],
          description: "again: wrong or no answer; hard: right with effort or a hint; good: right; easy: instant.",
        },
      },
      required: ["card_id", "rating"],
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
    case "next_card": {
      const next = await store.nextDueCard(await optionalDeckId(args.deck));
      if (!next.card) return { done: true, message: "No cards are due right now.", next_due_at: next.nextDueAt ?? null };
      const { card } = next;
      return {
        card: { card_id: card.id, front: card.front, back: card.back, notes: card.notes, reviews: card.reps, lapses: card.lapses },
        due_remaining: next.dueRemaining,
        reminder: "Ask the front only. Reveal the back after the user answers.",
      };
    }
    case "grade_card": {
      if (!isFlashcardRating(args.rating)) throw new FlashcardError("Rating must be again, hard, good, or easy.");
      const card = await store.gradeCard(text(args.card_id) ?? "", args.rating);
      return { card_id: card.id, rating: args.rating, next_due_at: card.dueAt, interval_days: card.intervalDays };
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
