import { appendConversationMessage, getConversation } from "@/lib/conversation-store";
import { listMemories } from "@/lib/memory-store";
import { getUserPreferences } from "@/lib/preference-store";
import {
  authenticatedPhoneCallOwner,
  endPhoneCall,
  getPhoneAssistantDestination,
  verifyPhoneCallPassphrase,
} from "@/lib/phone-assistant-store";
import { searchPhoneWeb } from "@/lib/phone-web-search";
import {
  phoneRealtimeCarryover,
  phoneRealtimeConversationInstructions,
} from "@/lib/realtime-sip";
import { createReminder, listReminders } from "@/lib/reminder-store";
import { reminderPlaceLabel } from "@/lib/reminder";
import {
  enqueueRemoteCommand,
  getAvailableRemoteDevice,
  getRemoteCommand,
} from "@/lib/remote-device-store";

type InternalRequest = {
  action?: unknown;
  callId?: unknown;
  transcript?: unknown;
  role?: unknown;
  messageId?: unknown;
  toolName?: unknown;
  arguments?: unknown;
};

function internalSecret() {
  return (
    process.env.VOX_CONTACT_SECRET?.trim() ||
    process.env.VOX_SESSION_SECRET?.trim() ||
    ""
  );
}

function constantTimeEqual(left: string, right: string) {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function authorized(request: Request) {
  const secret = internalSecret();
  const received = request.headers.get("x-vox-sip-secret")?.trim() ?? "";
  return Boolean(secret) && constantTimeEqual(secret, received);
}

export async function POST(request: Request) {
  if (!authorized(request)) return new Response("Forbidden", { status: 403 });
  const body = (await request.json().catch(() => ({}))) as InternalRequest;
  const callId = typeof body.callId === "string" ? body.callId.trim() : "";
  if (!/^rtc_[A-Za-z0-9_-]{8,}$/u.test(callId)) {
    return new Response("Invalid call", { status: 400 });
  }

  if (body.action === "authenticate") {
    const transcript = typeof body.transcript === "string"
      ? body.transcript.trim().slice(0, 500)
      : "";
    const ownerId = transcript
      ? await verifyPhoneCallPassphrase(callId, transcript)
      : null;
    if (!ownerId) return Response.json({ authenticated: false }, { status: 401 });

    const [preferences, memories, conversation] = await Promise.all([
      getUserPreferences(ownerId),
      listMemories(ownerId, 24),
      getConversation(ownerId),
    ]);
    return Response.json({
      authenticated: true,
      instructions: phoneRealtimeConversationInstructions(
        memories,
        preferences.replyLength,
      ),
      carryover: phoneRealtimeCarryover(conversation.messages),
    });
  }

  const ownerId = await authenticatedPhoneCallOwner(callId);
  if (!ownerId) return new Response("Authentication expired", { status: 401 });

  if (body.action === "sync") {
    const role = body.role === "assistant" ? "assistant" : body.role === "user" ? "user" : null;
    const text = typeof body.transcript === "string"
      ? body.transcript.trim().slice(0, 8_000)
      : "";
    if (!role || !text) return new Response("Invalid message", { status: 400 });
    const conversation = await getConversation(ownerId);
    await appendConversationMessage(ownerId, conversation.generation, {
      id:
        typeof body.messageId === "string" && body.messageId.length <= 180
          ? body.messageId
          : crypto.randomUUID(),
      role,
      text,
      source: "phone",
    });
    return Response.json({ saved: true });
  }

  if (body.action === "tool") {
    return executePhoneTool(ownerId, body.toolName, body.arguments);
  }

  if (body.action === "mac_device") {
    const device = await getAvailableRemoteDevice(ownerId);
    return Response.json({
      device: device ? { id: device.id, name: device.name } : null,
    });
  }

  if (body.action === "mac_enqueue") {
    const commandId = typeof body.messageId === "string" ? body.messageId : "";
    const values = body.arguments && typeof body.arguments === "object"
      ? body.arguments as Record<string, unknown>
      : {};
    const deviceId = typeof values.deviceId === "string" ? values.deviceId : "";
    const ciphertext = typeof values.ciphertext === "string" ? values.ciphertext : "";
    const iv = typeof values.iv === "string" ? values.iv : "";
    if (
      !/^[a-f0-9-]{36}$/u.test(commandId) ||
      !/^[a-f0-9-]{36}$/u.test(deviceId) ||
      !/^[A-Za-z0-9_-]+$/u.test(ciphertext) ||
      !/^[A-Za-z0-9_-]+$/u.test(iv) ||
      ciphertext.length > 32_000 ||
      iv.length > 128
    ) {
      return new Response("Invalid encrypted Mac command", { status: 400 });
    }
    const queued = await enqueueRemoteCommand(ownerId, {
      id: commandId,
      deviceId,
      ciphertext,
      iv,
      // The desktop decrypts the short-lived payload immediately, but a verified
      // Computer Use task can legitimately need the full local three-minute window.
      expiresAt: new Date(Date.now() + 4 * 60_000).toISOString(),
    });
    return Response.json({ queued });
  }

  if (body.action === "mac_status") {
    const commandId = typeof body.messageId === "string" ? body.messageId : "";
    if (!/^[a-f0-9-]{36}$/u.test(commandId)) {
      return new Response("Invalid Mac command", { status: 400 });
    }
    const command = await getRemoteCommand(ownerId, commandId);
    return Response.json({ command });
  }

  if (body.action === "close") {
    await endPhoneCall(callId);
    return Response.json({ closed: true });
  }

  return new Response("Unknown action", { status: 400 });
}

async function executePhoneTool(ownerId: string, name: unknown, rawArguments: unknown) {
  const argumentsObject = rawArguments && typeof rawArguments === "object"
    ? rawArguments as Record<string, unknown>
    : {};
  if (name === "search_web") {
    try {
      const result = await searchPhoneWeb(
        argumentsObject.query,
        process.env.OPENAI_API_KEY?.trim() ?? "",
      );
      return Response.json({
        output: JSON.stringify({ ok: true, ...result }),
      });
    } catch (error) {
      console.error("Phone web search failed", error);
      return Response.json({
        output: JSON.stringify({
          ok: false,
          error: "Live information is temporarily unavailable. Say this briefly without inventing an answer.",
        }),
      });
    }
  }
  if (name === "create_reminder") {
    const title = typeof argumentsObject.title === "string"
      ? argumentsObject.title.trim().slice(0, 180)
      : "";
    const notes = typeof argumentsObject.notes === "string"
      ? argumentsObject.notes.trim().slice(0, 500)
      : null;
    const dueAt = typeof argumentsObject.due_at === "string"
      ? argumentsObject.due_at.trim()
      : "";
    const dueTime = Date.parse(dueAt);
    if (!title || !Number.isFinite(dueTime) || dueTime <= Date.now()) {
      return Response.json({
        output: JSON.stringify({ ok: false, error: "A precise future time is required." }),
      });
    }
    const wantsCall = argumentsObject.call_me === true;
    const callAvailable = wantsCall &&
      Boolean(await getPhoneAssistantDestination(ownerId).catch(() => null));
    const reminder = await createReminder(ownerId, {
      title,
      notes,
      dueAt: new Date(dueTime).toISOString(),
      delivery: callAvailable ? "call" : "app",
    });
    return Response.json({
      output: JSON.stringify({
        ok: true,
        reminder,
        ...(wantsCall && !callAvailable
          ? { note: "Saved as an app reminder: calls from Vox are not enabled for this account." }
          : {}),
      }),
    });
  }
  if (name === "list_reminders") {
    const reminders = (await listReminders(ownerId, 40))
      .filter((reminder) => reminder.status === "pending" && Date.parse(reminder.dueAt) > Date.now())
      .slice(0, 5)
      // Location reminders have no time; describe them by place instead.
      .map((reminder) =>
        reminder.triggerType === "location"
          ? { title: reminder.title, when: reminderPlaceLabel(reminder, "taiwan_mandarin") }
          : { title: reminder.title, dueAt: reminder.dueAt, notes: reminder.notes },
      );
    return Response.json({
      output: JSON.stringify({ ok: true, reminders }),
    });
  }
  return Response.json({
    output: JSON.stringify({ ok: false, error: "Unsupported phone tool." }),
  });
}
