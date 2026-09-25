# Standalone Cloudflare deployment

Vox is ready to run as its own Cloudflare Worker with D1 and private R2 storage. These steps do not use ChatGPT Sites.

## 1. Create the production resources

Authenticate Wrangler, then create one D1 database and one private R2 bucket:

```bash
npx wrangler login
npx wrangler d1 create vox-production
npx wrangler r2 bucket create vox-files-production
```

Copy `.env.cloudflare.example` to `.env.cloudflare` and place the D1 database ID returned by Cloudflare in `CLOUDFLARE_D1_DATABASE_ID`. Change the names only if you created different ones, then load those variables before preparing a deployment.

```bash
set -a
source .env.cloudflare
set +a
```

## 2. Build and prepare the Worker

```bash
npm ci
npm run build
npm run deploy:prepare
```

This creates `dist/server/wrangler.deploy.json` with the real D1 and R2 bindings. It does not deploy anything.

## 3. Add production secrets

Set the provider keys, master activation code, and session secret against the
prepared configuration. Wrangler prompts for the value and keeps it out of the
repository.

```bash
npx wrangler secret put OPENAI_API_KEY --config dist/server/wrangler.deploy.json
npx wrangler secret put OPENAI_WEBHOOK_SECRET --config dist/server/wrangler.deploy.json
npx wrangler secret put OPENAI_SIP_PROJECT_ID --config dist/server/wrangler.deploy.json
npx wrangler secret put TYPESAFE_API_KEY --config dist/server/wrangler.deploy.json
npx wrangler secret put VOX_MASTER_CODE --config dist/server/wrangler.deploy.json
npx wrangler secret put VOX_SESSION_SECRET --config dist/server/wrangler.deploy.json
npx wrangler secret put VOX_CONTACT_SECRET --config dist/server/wrangler.deploy.json
npx wrangler secret put VOX_CONVERSATION_SECRET --config dist/server/wrangler.deploy.json
```

`VOX_MASTER_CODE` signs in the owner account, which can create unlimited share
codes from the Invite panel. Each invited account can create one share code.
Only keyed hashes of generated codes are stored in D1; the plaintext code is
shown once. `VOX_USERS_JSON` remains available for importing fixed member
accounts. It is a JSON array with a stable opaque ID and a unique access code of
at least 12 characters. Do not use an email address as the ID. For example:

```json
[{"id":"user-1","name":"User One","accessCode":"a-long-unique-private-code"}]
```

Every activation code is paired with an email address on first sign-in. The
address is encrypted before it is stored in D1 and must match on later sign-ins.
Use a separate long random value for `VOX_CONTACT_SECRET`; keep it stable so
stored addresses remain available for future service-email delivery.

Use another stable random value for `VOX_CONVERSATION_SECRET`. Vox encrypts
each synchronized transcript message with it before writing to D1; changing or
losing it makes existing synchronized conversations unreadable.

Use a long random value for `VOX_SESSION_SECRET`. Changing it signs everyone out. Removing a user from `VOX_USERS_JSON` immediately invalidates that user's existing session. `VOX_ACCESS_CODE` remains supported only as a single-owner compatibility setting.

### Optional Direct SIP phone calls

Direct SIP uses the same OpenAI project as `OPENAI_API_KEY` and keeps the Twilio number as the public phone entry point:

1. In OpenAI Platform, open the project **Webhooks** page. Create an endpoint at `https://your-vox-domain.example/api/openai/realtime-sip`, subscribe only to `realtime.call.incoming`, and save its one-time signing secret as `OPENAI_WEBHOOK_SECRET`.
2. Copy the `proj_...` value from that project's **General** settings into `OPENAI_SIP_PROJECT_ID`.
3. Keep the Twilio number's incoming voice webhook set to `POST https://your-vox-domain.example/api/twilio/voice`. When the SIP project ID is present, Vox returns TwiML that bridges the call to `sip:$OPENAI_SIP_PROJECT_ID@sip.api.openai.com;transport=tls`; without it, the older speech-gather flow remains available as a fallback.
4. Deploy the Worker. The prepared configuration binds `SIP_CALLS`, a per-call Durable Object that maintains the private sideband used for phrase verification, transcript sync, and reminder tools.

Do not subscribe the OpenAI webhook to unrelated event types. Rotate `OPENAI_WEBHOOK_SECRET` immediately if it is exposed. Direct SIP is inbound-only; the existing explicit Twilio test-call path remains separate.

## Privacy and multiple users

Every authenticated session is signed, expires after seven days, and resolves to one opaque owner ID. D1 queries for conversations, memories, reminders, file metadata, and activation codes always include the appropriate owner ID. Synchronized transcript messages are encrypted individually before storage. Generated file bodies remain in private R2 storage. A user who guesses another record ID receives `404` and cannot read, update, claim, or delete it.

The AI providers still receive the conversation content needed to answer, classify, transcribe, or create a requested file. OpenAI Responses calls use `store: false`; provider retention and organization-level data controls should be reviewed before inviting users. Keep D1 and R2 private, restrict Cloudflare account access, and enable rate limiting before a public launch.

## 4. Migrate and deploy

```bash
npm run deploy:migrate
npm run deploy:worker
```

Or, after the resources and secrets are configured, run `npm run deploy:cloudflare` to build, prepare, migrate, and deploy in one command.

## 5. Optional custom domain

After the first deployment, attach a custom domain in Cloudflare Workers & Pages. HTTPS is required for browser microphone access and for the secure Vox session cookie.

## Vox Flash Cards (optional)

Flash cards run on their own Worker, with its own D1 database, in `flashcards-site/`. Vox connects to it as an MCP client, and its users sign in with their Vox account.

```bash
npx wrangler d1 create vox-flashcards   # once; copy the database id
export FLASHCARDS_D1_DATABASE_ID=<that id>
npm run flashcards:deploy               # applies migrations and deploys
```

The site's `VOX_URL` (in `flashcards-site/wrangler.jsonc`, or `FLASHCARDS_VOX_URL` at deploy time) must point to your Vox deployment. Vox uses `https://vox-flashcards.<your-subdomain>.workers.dev/mcp` by default. Set `FLASHCARDS_MCP_URL` on the Vox Worker if the site lives elsewhere. No secrets are needed: every token is random and stored hashed, and Vox encrypts its connection tokens with `VOX_CONTACT_SECRET`.

## Reminder delivery

Reminder schedules are persisted in D1 and can be delivered three ways:

- **In the app** — the open web app checks the backend every 15 seconds and can show browser alerts once notification permission is enabled from the Reminders panel.
- **iPhone alerts** — the iOS app schedules upcoming reminders as local notifications, which fire even when Vox is closed. It learns about new reminders the next time the app opens.
- **Phone call** — the owner can mark a reminder for phone-call delivery. The prepared Worker configuration adds a Cloudflare Cron Trigger (`* * * * *`) that calls the owner's callback number through Twilio when such a reminder is due. It requires the Twilio settings above, a callback number, and **calls from Vox** turned on in Call Vox.
