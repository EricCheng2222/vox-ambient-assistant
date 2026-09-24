import { boundedRecentMessages } from "./conversation-context.ts";
import {
  appendConversationMessage,
  getConversation,
} from "./conversation-store.ts";
import { createReminder, listReminders } from "./reminder-store.ts";
import { getCurrentTimeContext } from "./time-context.ts";

type PhoneDecision = {
  action: "chat" | "create_reminder" | "list_reminders" | "end" | "unsupported";
  answer: string;
  reminder_title: string | null;
  reminder_notes: string | null;
  reminder_due_at: string | null;
};

function outputText(payload: {
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
}) {
  return (payload.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("")
    .trim();
}

function spokenReminderTime(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export async function handlePhoneAssistantPrompt(ownerId: string, prompt: string) {
  const spokenPrompt = prompt.trim().slice(0, 2000);
  let conversationGeneration: number | null = null;
  let conversationHistory: Array<{ role: "user" | "assistant"; text: string }> = [];

  try {
    const conversation = await getConversation(ownerId);
    conversationGeneration = conversation.generation;
    conversationHistory = boundedRecentMessages(conversation.messages);
    await appendConversationMessage(ownerId, conversation.generation, {
      id: crypto.randomUUID(),
      role: "user",
      text: spokenPrompt,
      source: "phone",
    });
  } catch (error) {
    console.error("Phone conversation sync failed", error);
  }

  const finish = async (result: { answer: string; end: boolean }) => {
    if (conversationGeneration !== null) {
      try {
        await appendConversationMessage(ownerId, conversationGeneration, {
          id: crypto.randomUUID(),
          role: "assistant",
          text: result.answer,
          source: "phone",
        });
      } catch (error) {
        console.error("Phone response sync failed", error);
      }
    }
    return result;
  };

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return finish({ answer: "Vox 的語音助理目前暫時無法使用。", end: false });
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": "vox-conservative-phone-assistant",
    },
    body: JSON.stringify({
      model: "gpt-5.6-luna",
      input: [
        ...conversationHistory.map((message) => ({
          role: message.role,
          content: message.text,
        })),
        { role: "user", content: spokenPrompt },
      ],
      instructions:
        "You are Vox in a natural, ongoing telephone conversation. The input includes a bounded history shared with the user's Vox web conversation and may include earlier web or phone turns. Continue that thread naturally when relevant without recapping it or announcing a channel change. Match the caller's language and tone: use natural Taiwan Mandarin when they speak Mandarin, and English when they clearly speak English. Keep ordinary replies concise enough to sound natural on a call, usually under 45 spoken words, but vary length with the caller. Do not default to advice; acknowledge, ask, joke, share a thought, or simply continue the conversation as appropriate. Allowed actions are: chat and factual questions; create one reminder; list pending reminders; end the call. Do not claim to control a computer, smart home, contact another person, send a message, purchase, delete, log in, or reveal private data. Those requests are unsupported. For a reminder, resolve a precise future ISO timestamp using the clock below. Return JSON only.\n\n" +
        getCurrentTimeContext(),
      reasoning: { effort: "none" },
      max_output_tokens: 320,
      store: false,
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "phone_assistant_decision",
          strict: true,
          schema: {
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: ["chat", "create_reminder", "list_reminders", "end", "unsupported"],
              },
              answer: { type: "string" },
              reminder_title: { type: ["string", "null"] },
              reminder_notes: { type: ["string", "null"] },
              reminder_due_at: { type: ["string", "null"], format: "date-time" },
            },
            required: ["action", "answer", "reminder_title", "reminder_notes", "reminder_due_at"],
            additionalProperties: false,
          },
        },
      },
    }),
  });
  if (!response.ok) return finish({ answer: "我現在暫時無法處理這個要求，請稍後再試。", end: false });
  const payload = (await response.json()) as Parameters<typeof outputText>[0];
  let decision: PhoneDecision;
  try {
    decision = JSON.parse(outputText(payload)) as PhoneDecision;
  } catch {
    return finish({ answer: "我沒有聽懂，可以換個方式再說一次嗎？", end: false });
  }

  if (decision.action === "end") {
    return finish({ answer: decision.answer || "好，下次再聊。", end: true });
  }
  if (decision.action === "unsupported") {
    return finish({
      answer:
        decision.answer ||
        "目前電話模式只支援聊天、查詢和提醒。電腦、智慧家庭或聯絡他人的操作仍然不會從電話直接執行。",
      end: false,
    });
  }
  if (decision.action === "list_reminders") {
    const reminders = (await listReminders(ownerId, 40)).filter(
      (reminder) => reminder.status === "pending" && Date.parse(reminder.dueAt) > Date.now(),
    );
    if (!reminders.length) return finish({ answer: "你目前沒有尚未完成的提醒。", end: false });
    const summary = reminders
      .slice(0, 3)
      .map((reminder) => `${spokenReminderTime(reminder.dueAt)}，${reminder.title}`)
      .join("；");
    return finish({ answer: `最近的提醒是：${summary}。`, end: false });
  }
  if (decision.action === "create_reminder") {
    const title = decision.reminder_title?.trim().slice(0, 180) ?? "";
    const dueAt = decision.reminder_due_at?.trim() ?? "";
    const dueTime = Date.parse(dueAt);
    if (!title || !Number.isFinite(dueTime) || dueTime <= Date.now()) {
      return finish({ answer: "我需要一個明確而且是未來的提醒時間。你想什麼時候提醒？", end: false });
    }
    await createReminder(ownerId, {
      title,
      notes: decision.reminder_notes?.trim().slice(0, 500) || null,
      dueAt: new Date(dueTime).toISOString(),
    });
    return finish({ answer: `好，已經設定提醒：${spokenReminderTime(new Date(dueTime).toISOString())}，${title}。`, end: false });
  }
  return finish({ answer: decision.answer || "好。", end: false });
}
