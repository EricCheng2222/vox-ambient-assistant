import type { MailAccount } from "../accounts.ts";
import type { Env } from "../util.ts";
import { GmailProvider } from "./gmail.ts";
import { GraphProvider } from "./graph.ts";
import { ImapProvider } from "./imap.ts";
import type { MailProvider } from "./types.ts";

export function openProvider(env: Env, account: MailAccount, siteUrl: string): MailProvider {
  if (account.provider === "gmail") return new GmailProvider(env, account, siteUrl);
  if (account.provider === "microsoft") return new GraphProvider(env, account, siteUrl);
  return new ImapProvider(env, account, siteUrl);
}
