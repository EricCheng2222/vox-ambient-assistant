import { requireUser } from "@/lib/auth";
import {
  appendConversationMessage,
  clearConversation,
  getConversation,
  setConversationMessageSource,
} from "@/lib/conversation-store";
import { isConversationRole, isConversationSource } from "@/lib/conversation";

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;

  try {
    return Response.json(await getConversation(auth.user.id), {
      headers: noStore,
    });
  } catch (error) {
    console.error("Conversation load failed", error);
    return Response.json(
      { error: "The conversation could not sync right now." },
      { status: 503, headers: noStore },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;

  const body = (await request.json().catch(() => null)) as {
    generation?: unknown;
    message?: { id?: unknown; role?: unknown; text?: unknown };
  } | null;
  const generation = Number(body?.generation);
  const id = typeof body?.message?.id === "string" ? body.message.id.trim() : "";
  const role = body?.message?.role;
  const text =
    typeof body?.message?.text === "string"
      ? body.message.text.trim().slice(0, 6000)
      : "";
  if (
    !Number.isSafeInteger(generation) ||
    generation < 1 ||
    !/^[0-9a-f-]{36}$/i.test(id) ||
    !isConversationRole(role) ||
    !text
  ) {
    return Response.json(
      { error: "A valid conversation message is required." },
      { status: 400, headers: noStore },
    );
  }

  try {
    const stored = await appendConversationMessage(auth.user.id, generation, {
      id,
      role,
      text,
      source: "local",
    });
    if (!stored) {
      return Response.json(
        { error: "The conversation changed on another device." },
        { status: 409, headers: noStore },
      );
    }
    return Response.json({ stored: true }, { status: 201, headers: noStore });
  } catch (error) {
    console.error("Conversation save failed", error);
    return Response.json(
      { error: "That message could not sync right now." },
      { status: 503, headers: noStore },
    );
  }
}

export async function PATCH(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;

  const body = (await request.json().catch(() => null)) as {
    generation?: unknown;
    id?: unknown;
    source?: unknown;
  } | null;
  const generation = Number(body?.generation);
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (
    !Number.isSafeInteger(generation) ||
    generation < 1 ||
    !id ||
    id.length > 180 ||
    !isConversationSource(body?.source)
  ) {
    return Response.json(
      { error: "A valid conversation message and source are required." },
      { status: 400, headers: noStore },
    );
  }

  try {
    const updated = await setConversationMessageSource(
      auth.user.id,
      generation,
      id,
      body.source,
    );
    if (!updated) {
      return Response.json(
        { error: "This message is no longer in the current conversation." },
        { status: 409, headers: noStore },
      );
    }
    return Response.json({ source: body.source }, { headers: noStore });
  } catch (error) {
    console.error("Conversation source update failed", error);
    return Response.json(
      { error: "The message could not be updated right now." },
      { status: 503, headers: noStore },
    );
  }
}

export async function DELETE(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;

  try {
    return Response.json(
      { generation: await clearConversation(auth.user.id) },
      { headers: noStore },
    );
  } catch (error) {
    console.error("Conversation clear failed", error);
    return Response.json(
      { error: "The conversation could not be cleared right now." },
      { status: 503, headers: noStore },
    );
  }
}
