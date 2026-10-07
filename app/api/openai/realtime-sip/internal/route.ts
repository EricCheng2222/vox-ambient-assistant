import { appendConversationMessage, appendIncomingText, getConversation } from "@/lib/conversation-store";
import { listMemories } from "@/lib/memory-store";
import { getUserPreferences } from "@/lib/preference-store";
import { loadProfileContext } from "@/lib/profile-store";
import {
  authenticatedPhoneCallOwner,
  endPhoneCall,
  getPhoneAssistantSettings,
  PHONE_ASSISTANT_OWNER_ID,
  getPhoneAssistantDestination,
  verifyPhoneCallPassphrase,
} from "@/lib/phone-assistant-store";
import { listLocationDevices } from "@/lib/location-store";
import { iPhoneLocationForCallers } from "@/lib/phone-location";
import { searchPhoneWeb } from "@/lib/phone-web-search";
import {
  phoneRealtimeCarryover,
  phoneRealtimeConversationInstructions,
} from "@/lib/realtime-sip";
import { createReminder, listReminders, reminderTimeZone } from "@/lib/reminder-store";
import { reminderPlaceLabel } from "@/lib/reminder";
import { firstOccurrence, reminderRepeatLabel, repeatFromExtraction } from "@/lib/reminder-repeat";
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
  caller?: unknown;
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
    if (!ownerId) {
      // Not the owner: while the phone assistant is on, Vox answers as the
      // owner's assistant instead of hanging up.
      const settings = await getPhoneAssistantSettings(PHONE_ASSISTANT_OWNER_ID).catch(() => null);
      return Response.json(
        {
          authenticated: false,
          guest: settings?.enabled === true,
          // The owner chose to let any caller ask where the iPhone is.
          guestLocation: settings?.enabled === true && settings.shareLocationWithCallers === true,
        },
        { status: 401 },
      );
    }

    const [preferences, memories, conversation] = await Promise.all([
      getUserPreferences(ownerId),
      listMemories(ownerId, 24),
      getConversation(ownerId),
    ]);
    // Only after the caller passed the private-sentence check.
    const profileContext = await loadProfileContext(
      ownerId,
      memories.map((memory) => memory.content),
    );
    return Response.json({
      authenticated: true,
      instructions: phoneRealtimeConversationInstructions(
        memories,
        preferences.replyLength,
        profileContext,
      ),
      carryover: phoneRealtimeCarryover(conversation.messages),
    });
  }

  if (body.action === "guest_sync") {
    // A line from a call Vox answered for an unverified caller. It is stored as
    // the other person's words, never as the owner's.
    const role = body.role === "assistant" ? "assistant" : body.role === "user" ? "user" : null;
    const text = typeof body.transcript === "string" ? body.transcript.trim().slice(0, 4_000) : "";
    const messageId = typeof body.messageId === "string" && /^guest_[A-Za-z0-9_-]{8,170}$/u.test(body.messageId)
      ? body.messageId
      : null;
    if (!role || !text || !messageId) return new Response("Invalid message", { status: 400 });
    const caller = typeof body.caller === "string" ? body.caller.replace(/[^\d+]/gu, "").slice(0, 20) : "";
    await appendIncomingText(PHONE_ASSISTANT_OWNER_ID, {
      id: messageId,
      source: "caller",
      role,
      from: caller || "Unknown caller",
      body: text,
    });
    return Response.json({ saved: true });
  }

  if (body.action === "guest_location") {
    // Re-checked at the moment of asking, so switching it off takes effect
    // even during a call.
    const settings = await getPhoneAssistantSettings(PHONE_ASSISTANT_OWNER_ID).catch(() => null);
    if (!settings?.enabled || !settings.shareLocationWithCallers) {
      return Response.json({ output: "Not available: the owner hasn't allowed callers to know where the phone is. Say you can't share that." });
    }
    const devices = await listLocationDevices(PHONE_ASSISTANT_OWNER_ID).catch(() => []);
    return Response.json({ output: iPhoneLocationForCallers(devices) });
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
  if (name === "where_is_iphone") {
    const devices = await listLocationDevices(ownerId).catch(() => []);
    return Response.json({ output: iPhoneLocationForCallers(devices) });
  }
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
    // The repeat is validated here; one that can't be kept exactly is asked
    // about instead of being saved as something else.
    const repeat = repeatFromExtraction(argumentsObject.repeat, await reminderTimeZone(ownerId));
    if (repeat.kind === "invalid") {
      return Response.json({
        output: JSON.stringify({ ok: false, error: `${repeat.reason} Ask the caller; do not create it yet.` }),
      });
    }
    const dueTime = repeat.kind === "rule"
      ? Date.parse(firstOccurrence(repeat.rule, repeat.startDate) ?? "")
      : Date.parse(dueAt);
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
      repeat: repeat.kind === "rule" ? repeat.rule : null,
    });
    return Response.json({
      output: JSON.stringify({
        ok: true,
        reminder,
        ...(reminder.repeat
          ? {
              when: {
                english: reminderRepeatLabel(reminder.repeat, "english", "spoken"),
                mandarin: reminderRepeatLabel(reminder.repeat, "taiwan_mandarin", "spoken"),
              },
            }
          : {}),
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
          : {
              title: reminder.title,
              dueAt: reminder.dueAt,
              notes: reminder.notes,
              ...(reminder.repeat
                ? { repeats: reminderRepeatLabel(reminder.repeat, "taiwan_mandarin", "spoken") }
                : {}),
            },
      );
    return Response.json({
      output: JSON.stringify({ ok: true, reminders }),
    });
  }
  return Response.json({
    output: JSON.stringify({ ok: false, error: "Unsupported phone tool." }),
  });
}
