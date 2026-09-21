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
npx wrangler secret put TYPESAFE_API_KEY --config dist/server/wrangler.deploy.json
npx wrangler secret put VOX_MASTER_CODE --config dist/server/wrangler.deploy.json
npx wrangler secret put VOX_SESSION_SECRET --config dist/server/wrangler.deploy.json
npx wrangler secret put VOX_CONTACT_SECRET --config dist/server/wrangler.deploy.json
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

Use a long random value for `VOX_SESSION_SECRET`. Changing it signs everyone out. Removing a user from `VOX_USERS_JSON` immediately invalidates that user's existing session. `VOX_ACCESS_CODE` remains supported only as a single-owner compatibility setting.

## Privacy and multiple users

Every authenticated session is signed, expires after seven days, and resolves to one opaque owner ID. D1 queries for memories, reminders, file metadata, and activation codes always include the appropriate owner ID. Generated file bodies remain in private R2 storage. A user who guesses another record ID receives `404` and cannot read, update, claim, or delete it.

The AI providers still receive the conversation content needed to answer, classify, transcribe, or create a requested file. OpenAI Responses calls use `store: false`; provider retention and organization-level data controls should be reviewed before inviting users. Keep D1 and R2 private, restrict Cloudflare account access, and enable rate limiting before a public launch.

## 4. Migrate and deploy

```bash
npm run deploy:migrate
npm run deploy:worker
```

Or, after the resources and secrets are configured, run `npm run deploy:cloudflare` to build, prepare, migrate, and deploy in one command.

## 5. Optional custom domain

After the first deployment, attach a custom domain in Cloudflare Workers & Pages. HTTPS is required for browser microphone access and for the secure Vox session cookie.

## Reminder delivery

Reminder schedules are persisted in D1. The current notification worker runs in the open browser and checks the backend every 15 seconds, so no Cloudflare Cron Trigger is required. Browser alerts require the user to enable notification permission from the Reminders panel. For alerts while the app is fully closed, add a Web Push, email, or messaging delivery provider before relying on Vox for critical reminders.
