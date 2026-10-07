# Vox Mail

A remote MCP server that gives Vox access to the owner's email. People sign in with their **Vox account** (“Sign in with Vox”), add one or more email accounts, and approve MCP clients. Vox connects the same way it connects to Vox Flash Cards.

Three kinds of account sit behind one interface (`src/providers/`):

- **Google** (Gmail, Google Workspace): Gmail REST API, OAuth. A Google account also brings its Calendar, Tasks, Contacts, and Drive (`src/google.ts`).
- **Microsoft** (Outlook.com, Hotmail, Live, Microsoft 365): Microsoft Graph, OAuth. Microsoft has turned off password sign-in for IMAP on Outlook.com, so these addresses always use this path.
- **Other (IMAP)** (iCloud, Yahoo, Fastmail, Zoho, Gmail with an app password, or any IMAP + SMTP server): the site's own IMAP and SMTP clients over Workers TCP sockets (`src/imap.ts`, `src/smtp.ts`), signing in with an app password.

Google and Microsoft appear only when their client secrets are set. IMAP needs only `MAIL_TOKEN_SECRET`.

## Endpoints

- `GET /`: the user's email accounts (Reconnect, Make primary, Remove) and connected apps
- `GET /accounts/add`: choose Google, Microsoft, or Other (IMAP)
- `/google/connect` (optional `login_hint`), `/google/callback`, `/microsoft/connect`, `/microsoft/callback`, `/imap/connect` (GET form, POST check and save)
- `POST /mcp`: the MCP server (Streamable HTTP, stateless JSON)
- OAuth for MCP clients: `/.well-known/oauth-protected-resource/mcp`, `/.well-known/oauth-authorization-server`, `/oauth/register`, `/oauth/authorize`, `/oauth/token`
- Sign in with Vox: `/auth/login`, `/auth/callback`

When an app asks for access and the user has no working account, `/oauth/authorize` parks the request in D1 behind a random nonce and sends them to "Add an email account". Once an account is connected, they come back to the approval page.

## Connecting from Vox in one step

`/oauth/authorize` takes three optional query parameters besides the standard OAuth ones, so an app can send the user straight to the right sign-in:

| Parameter | Values | What it does |
|---|---|---|
| `provider` | `google`, `microsoft`, `imap` | When the user has to connect an account, skip the chooser: go straight to Google's or Microsoft's consent screen, or to the app-password form. Anything else shows the chooser. |
| `login_hint` | an email address | Preselects that address at Google or Microsoft, or prefills the app-password form. Ignored if it isn't an address. |
| `add` | `1` | Connect another account first even if one already works ("connect another Gmail"), then continue. |

- `provider` only matters when an account has to be connected: the user has no working account, or `add=1` is set. Otherwise the request just continues.
- If `provider` names a sign-in that isn't configured here, the user sees "Gmail sign-in isn’t set up yet" with a button to the app-password form (for Microsoft, a button to the chooser).
- The app's request is parked in D1 while the user is away, so only a random state or nonce travels through Google, Microsoft, or this site's pages.

**Vox is approved automatically.** When the app's registered redirect URI is on the exact origin in `VOX_URL` (the Vox deployment users sign in with), a signed-in user with a working account gets no approval page: the authorization code goes straight back. PKCE and `state` work as usual. Every other app, including any look-alike origin, still gets the "wants to use your email" page.

**Signing in is a redirect, not a page.** A user who isn't signed in to Vox Mail is sent to `/auth/login`, which redirects at once to Vox's own sign-in and comes back to the same request.

So from Vox, "Connect Gmail" is: Vox → Google's consent screen → Vox.

## Tools

`list_accounts`, `search_email`, `read_email`, `read_thread`, `list_labels`, `unread_summary`, `create_draft`, `send_email`, `reply_email`, `forward_email`, `send_draft`, `modify_email`, `trash_email`, and `untrash_email`. There is no permanent delete.

- `search_email`, `unread_summary`, `list_labels`, `send_email`, and `create_draft` take an optional `account` (the email address).
  - Search and unread cover every account, merged by date.
  - Sending uses the primary account, which you can change on the home page.
- Message, thread, and draft ids carry their account (`m.<account>.<id>`, `t.…`, `d.…`), so reading, replying, forwarding, labelling, and trashing go to the right account automatically.
- `modify_email` keeps Gmail's label words in every account:
  - UNREAD maps to the read state.
  - STARRED maps to the flag.
  - Removing INBOX archives.
  - The account's own labels are Gmail labels, Outlook folders or categories, and IMAP folders.
- Sending, replying, forwarding, sending drafts, and trashing say in their tool descriptions that they need the user's spoken confirmation. Vox enforces that as well, with MCP `require_approval`.
- `unread_summary` takes `format: "json"` and then returns only `{"accounts":[{"address","provider"}],"unreadCount":n,"messages":[{"id","from","subject","snippet","account","date"}]}` with up to 20 of the newest unread emails. Each `id` is what `read_email` takes.

### The rest of a Google account

For a connected Google account: `list_events`, `create_event`, `update_event`, `invite_to_event`, `respond_to_event`, `delete_event`, `list_tasks`, `create_task`, `update_task`, `delete_task`, `search_contacts`, `create_contact`, `search_drive`, `read_drive_file`, `create_drive_file`, and `trash_drive_file`.

- Each takes an optional `account` (the Google address). Without it, the first Google account that allows that service is used.
- `list_accounts` says, for each Google account, which of calendar, tasks, contacts, and drive it allows.
- **More than one Google account.**
  - Without `account`, `list_events`, `list_tasks`, `search_contacts`, and `search_drive` cover every connected Google account that allows them. Results are merged (events by start, tasks by due date, `max` applies to the merged list), and each one names its account: the `account` field in JSON, and `account=` on each line of the text when the user has more than one Google account.
  - One account failing (access expired, a missing permission, a Google error) doesn't lose the others: the text ends with `(Note: couldn't read <account>: <why>)`, and the JSON gains `"problems":[{"account","message"}]`, present only when there is one. When every account fails, the call is the error, with its `needs_google_access:` prefix where that applies.
  - An invitation that reached two accounts is listed once per account, since each has its own reply. Only the same event on two calendars of one account is merged.
  - Tools that take an id (`update_event`, `invite_to_event` with `id`, `respond_to_event`, `delete_event`, `update_task`, `delete_task`, `read_drive_file`, `trash_drive_file`) look for it in each Google account when `account` is left out. Found in more than one, the error names them and asks for `account` (`read_drive_file` just reads it). Pass the `account` shown with the item to skip the lookup.
  - `create_event`, `invite_to_event` without `id`, `create_task`, `create_contact`, and `create_drive_file` use the first Google account that allows it unless `account` is given, and their answer names the account.
  - With `account`, or with one Google account, every tool behaves as it did.
- **Missing access.** A tool that needs a permission the account doesn't have returns an error whose text starts with `needs_google_access:` (for example `needs_google_access: Reconnect Google in Vox Mail to allow calendar access.`). The same prefix is used when Google answers 403 for a missing scope or an API that isn't enabled, and when the Google account needs reconnecting. With no Google account at all, the text starts with `no_google_account:`.
- **Calendar.**
  - `list_events` reads the calendars ticked in the user's Google Calendar, from now through 7 days unless `from` and `to` say otherwise. A time without an offset is in the user's own time zone, and a date for `to` includes that whole day.
  - `create_event` and `update_event` never have guests and never email anyone (`sendUpdates=none`). Only `invite_to_event` adds guests, and Google emails them (`sendUpdates=all`).
  - All-day events use dates, and `end` is the event's last day (Google's own API uses the day after).
  - `respond_to_event` `{id, response, calendar?, account?, note?}` answers an invitation: it sets the user's own reply (`accepted`, `declined`, or `tentative`) and Google tells the organizer (`sendUpdates=all`), as Google Calendar does. Only the user's own guest entry changes (`note` becomes its comment). It fails when the user isn't a guest of the event, such as their own event. Its description says to call it only after the user has said whether they're going.
  - `calendar` is a calendar's name or id; the default is the primary calendar.
- **Tasks.** `list` is a task list's name or id. `update_task` and `delete_task` need it. Google Tasks keeps only the date of a due date.
- **Contacts.** `search_contacts` sends Google's warm-up request first. "Other contacts" (people the user has emailed) are searched only when the grant includes `contacts.other.readonly`, which the connect flow does not ask for.
- **Drive.** `read_drive_file` exports Google Docs and Slides as text and Sheets as CSV (the first sheet), downloads plain-text files, and refuses everything else. `create_drive_file` makes a Google Doc from plain text. `trash_drive_file` moves a file to the trash; nothing is deleted for good.
- `invite_to_event`, `delete_event`, `delete_task`, and `trash_drive_file` say in their descriptions that they need the user's spoken confirmation.
- `format: "json"` on `list_events` and `list_tasks` returns only a JSON string:
  - `{"events":[{"id","title","start","end","allDay","location","account","calendar","response","organizer","attendees"}]}`. `start` and `end` are ISO date-times with an offset, or `YYYY-MM-DD` for all-day events; `end` and `location` may be `null`; `calendar` is the calendar's name.
    - `response` is the user's own reply: `accepted`, `declined`, `tentative`, `needs_reply` (not answered yet), or `own` when there is nothing to answer: the user organizes the event, or isn't one of its guests (which includes every event with no guests).
    - `organizer` is the organizer's name or email (at most 80 characters, `""` when unknown), and `attendees` is how many other people are invited (rooms aren't counted).
    - The readable text adds an "Invitation … hasn't answered yet" line to events whose `response` is `needs_reply`.
  - `{"tasks":[{"id","title","due","completed","list","listId","account"}]}`. `due` is `YYYY-MM-DD` or `null`.

## Setup (once)

### Encryption secret (required)

```bash
openssl rand -base64 32 | npx wrangler secret put MAIL_TOKEN_SECRET --config mail-site/wrangler.jsonc
```

It encrypts every OAuth refresh token and IMAP app password in D1 (AES-GCM, bound to the user and the account). If you change it, stored accounts can no longer be read and must be connected again.

### Google (Gmail)

1. In [console.cloud.google.com](https://console.cloud.google.com), create a project (for example “Vox Mail”), then open **APIs & Services → Library** and enable the **Gmail API**, **Google Calendar API**, **Google Tasks API**, **People API**, and **Google Drive API**. A tool whose API isn't enabled answers `needs_google_access:`.
2. Open **Google Auth Platform** (the OAuth consent screen):
   - **Audience:** External. Under **Test users**, add your own Gmail address.
   - **Data access:** add `openid`, `.../auth/userinfo.email`, and `https://www.googleapis.com/auth/` `gmail.modify`, `calendar`, `tasks`, `contacts`, and `drive`.
   - Then, under **Audience**, click **Publish app** so it is **In production**.
     - In Testing mode Google expires refresh tokens after 7 days, and Vox would lose Gmail every week.
     - An unverified app in production shows a “Google hasn’t verified this app” warning. As the owner, click **Advanced → Go to Vox Mail (unsafe)** and it works. Verification is only needed for other people.
3. Open **Clients → Create client**, choose **Web application**, and add the redirect URI `https://vox-mail.ericcheng306.workers.dev/google/callback`.
4. Set the secrets:

   ```bash
   npx wrangler secret put GOOGLE_CLIENT_ID --config mail-site/wrangler.jsonc
   npx wrangler secret put GOOGLE_CLIENT_SECRET --config mail-site/wrangler.jsonc
   ```

`gmail.modify` covers reading, composing, sending, labels, and Trash, but not permanent deletion.

Only `gmail.modify` is required. Google lets people untick the other permissions, and an account connected before they were asked for has only mail. The granted scopes are stored with the account (`mail_accounts.scope`). The home page shows what Vox can use and, where something is missing, an **Allow calendar, tasks, contacts and files** button that runs the Google sign-in again for that address. Reconnecting an address updates its account in place: same id, new tokens and scopes.

### Microsoft (Outlook.com and Microsoft 365)

1. In [entra.microsoft.com](https://entra.microsoft.com), open **Identity → Applications → App registrations → New registration**.
   - **Name:** Vox Mail.
   - **Supported account types:** *Accounts in any organizational directory and personal Microsoft accounts*. That is the `common` tenant, which covers Outlook.com, Hotmail, and work or school accounts.
   - **Redirect URI:** platform **Web**, `https://vox-mail.ericcheng306.workers.dev/microsoft/callback`.
2. On the app's **Overview**, copy the **Application (client) ID**.
3. **Certificates & secrets → New client secret**. Copy its **Value** (not the ID). Secrets expire (at most 24 months), so put a reminder in your calendar to renew it.
4. **API permissions → Add a permission → Microsoft Graph → Delegated**: `offline_access`, `Mail.ReadWrite`, `Mail.Send`, `User.Read`. None needs admin consent for personal accounts. A work tenant's admin may still have to approve the app.
5. Set the secrets:

   ```bash
   npx wrangler secret put MS_CLIENT_ID --config mail-site/wrangler.jsonc
   npx wrangler secret put MS_CLIENT_SECRET --config mail-site/wrangler.jsonc
   ```

### Other email (IMAP): app passwords

Nothing to set up on the server. The owner picks a provider on the IMAP form, types their address and an **app password** (never their normal password), and Vox Mail signs in to both IMAP and SMTP before saving anything. Only ports 993/143 (IMAP) and 465/587 (SMTP) are allowed, always with TLS or STARTTLS.

- **iCloud:** needs two-factor authentication on the Apple Account. Go to [account.apple.com](https://account.apple.com) → **Sign-In and Security → App-Specific Passwords**, and create one named “Vox Mail”. Use your @icloud.com (or @me.com) address. iCloud files sent mail in Sent itself.
- **Yahoo:** go to [login.yahoo.com](https://login.yahoo.com) → **Account Info → Account Security → Generate app password**. Vox Mail saves a copy of sent mail in Sent.
- **Gmail with an app password** (instead of Sign in with Google): turn on 2-Step Verification, then create one at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords). IMAP is always on for Gmail. Google Workspace admins can turn app passwords off.
- **Fastmail:** Settings → Privacy & Security → **Manage app passwords**, with IMAP and SMTP access.
- **Zoho:** turn on IMAP in Zoho Mail settings, then create an app-specific password at accounts.zoho.com → Security.
- **Outlook.com, Hotmail, Live:** not possible with a password. Use Sign in with Microsoft.

If the password is revoked, the next tool call marks the account “needs reconnecting” and the home page offers **Reconnect**. Reconnecting keeps the account id, so earlier message ids keep working.

## Deploy

```bash
npx wrangler d1 create vox-mail          # once; copy the database id
export MAIL_D1_DATABASE_ID=<that id>
npm run mail:deploy                      # applies migrations and deploys
```

`npm run mail:deploy -- --help` only prints help.

- The site's `VOX_URL` (in `mail-site/wrangler.jsonc`, or `MAIL_VOX_URL` at deploy time) must point to your Vox deployment.
- The deploy adds a `VOX` service binding to the Vox Worker (`CLOUDFLARE_WORKER_NAME`, default `vox-assistant`), because Workers on one account cannot fetch each other's workers.dev URLs.

## Develop

```bash
npx wrangler d1 migrations apply DB --local --config mail-site/wrangler.jsonc
npm run mail:dev
npm run mail:typecheck
npm run test:mail
```

- Set `VOX_URL` to your Vox instance, for example `--var VOX_URL:http://127.0.0.1:8799` when both run locally.
- Put local secrets in `mail-site/.dev.vars`, and add `http://127.0.0.1:8787/google/callback` and `/microsoft/callback` to the OAuth clients' redirect URIs.
- The tests fake everything external:
  - Google and Graph through a mocked `fetch`.
  - IMAP and SMTP through in-memory servers behind a scripted socket (`test/fake-mail-server.mjs`).
