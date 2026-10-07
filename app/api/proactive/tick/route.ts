import { appendAssistantNote, recentOwnerMessages } from "@/lib/conversation-store";
import { callMcpTool } from "@/lib/mcp-call";
import { veloServerUrl } from "@/lib/mcp-client";
import { createOwnerTexter } from "@/lib/owner-text";
import { getOwnerTextDestination, listProactiveTextOwnerIds } from "@/lib/phone-assistant-store";
import { getUserPreferences } from "@/lib/preference-store";
import { proactiveTextStore } from "@/lib/proactive-text-store";
import { ownerLanguage, voxLink } from "@/lib/proactive-texts";
import { runProactiveTick, writeBriefingText } from "@/lib/proactive-tick";
import { reminderTimeZone } from "@/lib/reminder-store";
import { schedulerAuthorized } from "@/lib/scheduler-auth";
import { buildBriefing } from "@/lib/today-briefing";
import { askJev } from "@/lib/today-jev";
import { getTwilioConfig } from "@/lib/twilio";

// "Vox reaches you when it's closed": the check the Worker's cron runs every
// 15 minutes. It texts an account's owner, at their own stored number, when
// something is worth interrupting for, and sends a morning briefing and an
// evening review. Reached only in-process from the cron handler; to anyone
// else it does not exist. It takes no input: who is checked, what is sent,
// and to which number are all decided here from what is stored.
export async function POST(request: Request) {
  if (!schedulerAuthorized(request)) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  try {
    // Without a phone line there is nobody to text: read nothing at all.
    if (!getTwilioConfig()) {
      return Response.json({ checked: 0, sent: 0, failed: 0, skipped: 0, errors: 0, deferred: 0 }, { headers: { "Cache-Control": "no-store" } });
    }
    const summary = await runProactiveTick({
      listAccounts: listProactiveTextOwnerIds,
      initiative: async (ownerId) => (await getUserPreferences(ownerId)).initiative,
      // The zone the owner's own device last reported, else Asia/Taipei.
      timeZone: reminderTimeZone,
      store: proactiveTextStore,
      buildBriefing,
      askJev,
      language: async (ownerId) => ownerLanguage(await recentOwnerMessages(ownerId)),
      notebookToday: async (ownerId) => {
        const result = await callMcpTool(ownerId, veloServerUrl(), "get_today");
        return result && !result.isError ? result.text : null;
      },
      write: (summary, language) => writeBriefingText(summary, language, { apiKey: process.env.OPENAI_API_KEY }),
      send: createOwnerTexter({ destinationFor: getOwnerTextDestination }),
      appendToConversation: (ownerId, id, text) => appendAssistantNote(ownerId, { id, text }),
      // The deployment's public address, as already configured for Twilio.
      link: voxLink(process.env.TWILIO_WEBHOOK_BASE_URL),
    });
    return Response.json(summary, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Proactive text check failed", error instanceof Error ? error.message : "");
    return Response.json({ error: "Proactive texts are unavailable." }, { status: 503 });
  }
}
