import { requireUser } from "@/lib/auth";
import type { MemoryCategory } from "@/lib/memory";
import { summarizeMemory } from "@/lib/memory-summary";
import {
  createMemory,
  deleteMemory,
  listMemories,
  updateMemory,
} from "@/lib/memory-store";

const CATEGORIES: MemoryCategory[] = [
  "preference",
  "identity",
  "goal",
  "relationship",
  "constraint",
  "context",
];

function storageError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  if (message.includes("no such table") || message.includes('from "memories"')) {
    return "Memory storage is not ready yet.";
  }
  return "Memory is temporarily unavailable.";
}

function looksLikeSecret(text: string) {
  return [
    /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/,
    /\bapikey[_-][A-Za-z0-9_-]{20,}\b/i,
    /\b(?:password|passcode|one[- ]time code|otp)\s*[:=]\s*\S+/i,
    /\b(?:bearer|authorization)\s+[A-Za-z0-9._~-]{16,}/i,
    /\b\d{13,19}\b/,
  ].some((pattern) => pattern.test(text));
}

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;

  try {
    return Response.json(
      { memories: await listMemories(auth.user.id) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Memory list failed", error);
    return Response.json({ error: storageError(error) }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { text?: string };
  const text = body.text?.trim().slice(0, 2000) ?? "";
  if (!text || looksLikeSecret(text)) {
    return Response.json({ action: "ignore", source: "safety" });
  }

  const jevApiKey = process.env.TYPESAFE_API_KEY;
  const openAiApiKey = process.env.OPENAI_API_KEY;
  if (!jevApiKey || !openAiApiKey) {
    return Response.json({ action: "ignore", source: "unavailable" });
  }

  try {
    const existing = await listMemories(auth.user.id, 12);
    const criteria: Record<string, string> = {
      ignore:
        "Do not store it. Use for questions, commands, greetings, transient status, one-off details, guesses, third-party private information, or anything not useful in a future conversation.",
      ...Object.fromEntries(
        CATEGORIES.map((category) => [
          `create_${category}`,
          `Create a new ${category} memory because this is a durable, user-specific fact that will likely improve future conversations.`,
        ]),
      ),
      ...Object.fromEntries(
        existing.map((_, index) => [
          `update_${index}`,
          `Update existing memory at index ${index} because the new statement corrects, replaces, or meaningfully refines it.`,
        ]),
      ),
    };

    const jevResponse = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jevApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "jev-latest",
        state: {
          utterance: text,
          existing_memories: existing.map(({ id, category, content, updatedAt }) => ({
            id,
            category,
            content,
            updatedAt,
          })),
        },
        questions: {
          memory_action: {
            type: "choice",
            instructions:
              "Decide whether an ambient personal assistant should remember this user utterance for future sessions. Store only durable, user-specific information: stable preferences, identity/background, ongoing goals, important relationships, lasting constraints, or continuing context. Ignore requests and questions, momentary plans, casual remarks, assistant-directed commands, uncertain inferences, and details that will probably expire soon. Never store credentials, authentication codes, financial account data, government identifiers, or other secrets. Prefer updating one existing memory when the utterance corrects, replaces, or refines it; otherwise create at most one new memory. A separate summarization step will turn the selected information into a short standalone fact, so judge the meaning rather than the utterance's wording.",
            criteria,
          },
        },
      }),
    });

    if (!jevResponse.ok) throw new Error(`Jev returned ${jevResponse.status}`);
    const payload = (await jevResponse.json()) as {
      answers?: {
        memory_action?: { choice?: string; confidence?: number };
      };
    };
    const choice = payload.answers?.memory_action?.choice ?? "ignore";
    const confidence = payload.answers?.memory_action?.confidence ?? null;

    if (choice === "ignore") {
      return Response.json({ action: "ignore", confidence, source: "jev" });
    }

    if (choice.startsWith("update_")) {
      const index = Number(choice.slice("update_".length));
      const target = Number.isInteger(index) ? existing[index] : undefined;
      if (!target) throw new Error("Jev selected an invalid memory target");
      const summary = await summarizeMemory({
        apiKey: openAiApiKey,
        category: target.category,
        utterance: text,
        previousContent: target.content,
      });
      if (looksLikeSecret(summary)) throw new Error("Unsafe memory summary");
      const memory = await updateMemory(auth.user.id, target.id, summary);
      if (!memory) throw new Error("The selected memory no longer exists");
      return Response.json({ action: "update", memory, confidence, source: "jev" });
    }

    if (choice.startsWith("create_")) {
      const category = choice.slice("create_".length) as MemoryCategory;
      if (!CATEGORIES.includes(category)) throw new Error("Invalid memory category");
      const summary = await summarizeMemory({
        apiKey: openAiApiKey,
        category,
        utterance: text,
      });
      if (looksLikeSecret(summary)) throw new Error("Unsafe memory summary");
      const memory = await createMemory(auth.user.id, { category, content: summary });
      return Response.json(
        { action: "create", memory, confidence, source: "jev" },
        { status: 201 },
      );
    }

    throw new Error("Jev returned an invalid memory action");
  } catch (error) {
    console.error("Memory decision or summarization failed", error);
    return Response.json({ action: "ignore", source: "fallback" });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { id?: string };
  const id = body.id?.trim() ?? "";
  if (!id) return Response.json({ error: "Memory id is required." }, { status: 400 });

  try {
    const deletedId = await deleteMemory(auth.user.id, id);
    if (!deletedId) return Response.json({ error: "Memory not found." }, { status: 404 });
    return Response.json({ deletedId });
  } catch (error) {
    console.error("Memory deletion failed", error);
    return Response.json({ error: storageError(error) }, { status: 503 });
  }
}
