# Standalone Cloudflare deployment

Vox is ready to run as its own Cloudflare Worker with D1 and R2. These steps do not use ChatGPT Sites.

## 1. Create the production resources

Authenticate Wrangler, then create one D1 database and one private R2 bucket:

```bash
npx wrangler login
npx wrangler d1 create vox-production
npx wrangler r2 bucket create vox-files-production
```

Copy `.env.cloudflare.example` to `.env.cloudflare` and place the D1 database ID returned by Cloudflare in `CLOUDFLARE_D1_DATABASE_ID`. Change the names only if you created different ones, then load those variables before preparing a deployment:

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

Set all four secrets against the prepared configuration. Wrangler prompts for the value and keeps it out of the repository.

```bash
npx wrangler secret put OPENAI_API_KEY --config dist/server/wrangler.deploy.json
npx wrangler secret put TYPESAFE_API_KEY --config dist/server/wrangler.deploy.json
npx wrangler secret put VOX_ACCESS_CODE --config dist/server/wrangler.deploy.json
npx wrangler secret put VOX_SESSION_SECRET --config dist/server/wrangler.deploy.json
```

Use a memorable private access code for `VOX_ACCESS_CODE` and a long random value for `VOX_SESSION_SECRET`.

## 4. Migrate and deploy

```bash
npm run deploy:migrate
npm run deploy:worker
```

Or, after the resources and secrets are configured, run `npm run deploy:cloudflare` to build, prepare, migrate, and deploy in one command.

## 5. Optional custom domain

After the first deployment, attach a custom domain in Cloudflare Workers & Pages. HTTPS is required for browser microphone access and for the secure Vox session cookie.
