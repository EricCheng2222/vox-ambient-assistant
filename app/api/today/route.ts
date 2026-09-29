import { requireUser } from "@/lib/auth";
import { callMcpTools, type McpToolResult } from "@/lib/mcp-call";
import { flashcardsServerUrl, mailServerUrl } from "@/lib/mcp-client";
import type { TodayBriefing, TodayFlashcards, TodayMail } from "@/lib/today";
import { cleanText, parseFlashcardDecks, parseMailAccounts, parseUnreadSummary } from "@/lib/today-parse";

// The parts of the Today briefing that live on other services: unread email
// from Vox Mail and due flash cards from Vox Flash Cards. Each side is read on
// its own; one failing never fails the other.

function failure(result: PromiseSettledResult<McpToolResult>, fallback: string) {
  if (result.status === "rejected") return result.reason instanceof Error ? result.reason.message : fallback;
  // Tool errors come from the server itself (not from email content).
  return result.value.isError ? cleanText(result.value.text, 200) || fallback : null;
}

async function readMail(ownerId: string): Promise<TodayMail> {
  const empty: TodayMail = { connected: true, accounts: [], unreadCount: null, unread: [] };
  try {
    const results = await callMcpTools(ownerId, mailServerUrl(), [
      { name: "list_accounts" },
      { name: "unread_summary" },
    ]);
    if (!results) return { ...empty, connected: false };
    const [accountsResult, unreadResult] = results;
    const accounts = accountsResult.status === "fulfilled" && !accountsResult.value.isError
      ? parseMailAccounts(accountsResult.value.text)
      : null;
    // No accounts on the mail site yet: nothing is unread, and unread_summary
    // reports that as an error.
    if (accounts?.length === 0) return { ...empty, unreadCount: 0 };
    const summary = unreadResult.status === "fulfilled" && !unreadResult.value.isError
      ? parseUnreadSummary(unreadResult.value.text)
      : null;
    const mail: TodayMail = {
      ...empty,
      accounts: accounts ?? summary?.accounts ?? [],
      unreadCount: summary?.unreadCount ?? null,
      unread: summary?.unread ?? [],
    };
    if (!summary) {
      mail.error =
        failure(unreadResult, "Vox Mail could not be read.") ??
        "Vox Mail answered in a way Vox could not read.";
    }
    return mail;
  } catch (error) {
    console.error("Today: mail failed", error instanceof Error ? error.message : "unknown");
    return { ...empty, error: "Vox Mail could not be reached." };
  }
}

async function readFlashcards(ownerId: string): Promise<TodayFlashcards> {
  const empty: TodayFlashcards = { connected: true, decks: [], totalDue: null };
  try {
    const results = await callMcpTools(ownerId, flashcardsServerUrl(), [{ name: "list_decks" }]);
    if (!results) return { ...empty, connected: false };
    const [result] = results;
    const parsed = result.status === "fulfilled" && !result.value.isError ? parseFlashcardDecks(result.value.text) : null;
    if (!parsed) {
      return {
        ...empty,
        error:
          failure(result, "Vox Flash Cards could not be read.") ??
          "Vox Flash Cards answered in a way Vox could not read.",
      };
    }
    return { ...empty, ...parsed };
  } catch (error) {
    console.error("Today: flash cards failed", error instanceof Error ? error.message : "unknown");
    return { ...empty, error: "Vox Flash Cards could not be reached." };
  }
}

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  const [mail, flashcards] = await Promise.all([readMail(auth.user.id), readFlashcards(auth.user.id)]);
  const briefing: TodayBriefing = { mail, flashcards, generatedAt: new Date().toISOString() };
  return Response.json(briefing, { headers: { "Cache-Control": "no-store" } });
}
