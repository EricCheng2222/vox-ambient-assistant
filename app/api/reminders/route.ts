import { requireUser } from "@/lib/auth";
import {
  isReminderDelivery,
  isReminderPostpone,
  postponedDueAt,
  type ReminderStatus,
} from "@/lib/reminder";
import {
  createReminder,
  deleteReminder,
  listReminders,
  postponeReminder,
  updateReminderDelivery,
  updateReminderStatus,
} from "@/lib/reminder-store";
import {
  getPhoneAssistantDestination,
  PHONE_ASSISTANT_OWNER_ID,
} from "@/lib/phone-assistant-store";
import { getCurrentTimeContext } from "@/lib/time-context";
import {
  API_BUDGET_MESSAGE,
  isProviderBudgetError,
  ProviderBudgetError,
} from "@/lib/provider-error";

const CALL_UNAVAILABLE_MESSAGE =
  "Phone-call reminders need Call Vox set up with a callback number and calls from Vox turned on.";

// Phone-call delivery is limited to the owner, whose own callback number is the
// only number Vox ever dials.
async function canDeliverByCall(user: { id: string; role: string }) {
  if (user.role !== "master" || user.id !== PHONE_ASSISTANT_OWNER_ID) return false;
  return Boolean(await getPhoneAssistantDestination(user.id).catch(() => null));
}

function readOutputText(payload: {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
}) {
  if (payload.output_text) return payload.output_text;
  return (payload.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text ?? "")
    .join("\n")
    .trim();
}

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;

  try {
    return Response.json(
      { reminders: await listReminders(auth.user.id) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Reminder list failed", error);
    return Response.json({ error: "Reminders are temporarily unavailable." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { text?: string };
  const text = body.text?.trim().slice(0, 4000) ?? "";
  if (!text) return Response.json({ error: "A reminder request is required." }, { status: 400 });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "Reminder creation is not configured." }, { status: 503 });

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": "vox-private-reminder-parser",
      },
      body: JSON.stringify({
        model: "gpt-5.6-terra",
        input: text,
        instructions:
          "Extract one reminder from the user's request. Resolve relative dates and times against the authoritative clock below. Use Asia/Taipei unless the user explicitly gives another time zone. Return a concise reminder title in the user's language, an optional short note, an exact future ISO 8601 timestamp including its UTC offset, and a delivery method. Use delivery 'call' only when the user explicitly asks to be phoned or called for this reminder (for example 'call me', 'phone me', or 打電話提醒我); otherwise use 'app'. If the user gives a date without a time, use 09:00. If they give only a time and that time has already passed today, use tomorrow. Do not invent a reminder unrelated to the request.\n\n" +
          getCurrentTimeContext(),
        reasoning: { effort: "low" },
        max_output_tokens: 600,
        store: false,
        text: {
          verbosity: "low",
          format: {
            type: "json_schema",
            name: "scheduled_reminder",
            strict: true,
            schema: {
              type: "object",
              properties: {
                title: { type: "string" },
                notes: { type: ["string", "null"] },
                due_at: { type: "string", format: "date-time" },
                delivery: { type: "string", enum: ["app", "call"] },
              },
              required: ["title", "notes", "due_at", "delivery"],
              additionalProperties: false,
            },
          },
        },
      }),
    });
    const payload = (await response.json()) as Parameters<typeof readOutputText>[0];
    if (!response.ok) {
      if (isProviderBudgetError(response, payload)) throw new ProviderBudgetError();
      throw new Error(`OpenAI returned ${response.status}`);
    }
    const parsed = JSON.parse(readOutputText(payload)) as {
      title?: string;
      notes?: string | null;
      due_at?: string;
      delivery?: string;
    };
    const title = parsed.title?.trim().slice(0, 180) ?? "";
    const dueAt = parsed.due_at?.trim() ?? "";
    const dueTime = Date.parse(dueAt);
    if (!title || !Number.isFinite(dueTime) || dueTime <= Date.now()) {
      return Response.json(
        { error: "Please choose a future date and time for the reminder." },
        { status: 400 },
      );
    }
    const wantsCall = parsed.delivery === "call";
    const callAvailable = wantsCall && (await canDeliverByCall(auth.user));
    const reminder = await createReminder(auth.user.id, {
      title,
      notes: parsed.notes?.trim().slice(0, 500) || null,
      dueAt: new Date(dueTime).toISOString(),
      delivery: callAvailable ? "call" : "app",
    });
    return Response.json(
      {
        reminder,
        ...(wantsCall && !callAvailable ? { deliveryNotice: CALL_UNAVAILABLE_MESSAGE } : {}),
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Reminder creation failed", error);
    return Response.json(
      {
        error:
          error instanceof ProviderBudgetError
            ? API_BUDGET_MESSAGE
            : "Vox could not schedule that reminder yet.",
      },
      { status: error instanceof ProviderBudgetError ? 402 : 502 },
    );
  }
}

export async function PATCH(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;

  const body = (await request.json().catch(() => ({}))) as {
    id?: unknown;
    status?: ReminderStatus;
    delivery?: unknown;
    postpone?: unknown;
  };
  const id = typeof body.id === "string" ? body.id.trim() : "";

  if (body.postpone !== undefined) {
    if (!id || !isReminderPostpone(body.postpone)) {
      return Response.json({ error: "A valid reminder update is required." }, { status: 400 });
    }
    const reminder = await postponeReminder(auth.user.id, id, postponedDueAt(body.postpone));
    if (!reminder) {
      return Response.json({ error: "Only an open reminder can be postponed." }, { status: 404 });
    }
    return Response.json({ reminder });
  }

  if (body.delivery !== undefined) {
    if (!id || !isReminderDelivery(body.delivery)) {
      return Response.json({ error: "A valid reminder update is required." }, { status: 400 });
    }
    if (body.delivery === "call" && !(await canDeliverByCall(auth.user))) {
      return Response.json({ error: CALL_UNAVAILABLE_MESSAGE }, { status: 409 });
    }
    const reminder = await updateReminderDelivery(auth.user.id, id, body.delivery);
    if (!reminder) {
      return Response.json(
        { error: "Only an upcoming reminder can change how it is delivered." },
        { status: 404 },
      );
    }
    return Response.json({ reminder });
  }

  const status = body.status;
  if (!id || !status || !["pending", "completed", "dismissed"].includes(status)) {
    return Response.json({ error: "A valid reminder update is required." }, { status: 400 });
  }
  const reminder = await updateReminderStatus(auth.user.id, id, status);
  if (!reminder) return Response.json({ error: "Reminder not found." }, { status: 404 });
  return Response.json({ reminder });
}

export async function DELETE(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { id?: string };
  const id = body.id?.trim() ?? "";
  if (!id) return Response.json({ error: "Reminder id is required." }, { status: 400 });
  const deletedId = await deleteReminder(auth.user.id, id);
  if (!deletedId) return Response.json({ error: "Reminder not found." }, { status: 404 });
  return Response.json({ deletedId });
}
