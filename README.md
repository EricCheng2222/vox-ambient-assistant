# Vox

Vox is a source-available voice companion that listens without forcing rigid turns. You can pause, continue a thought, interrupt a reply, or let Vox decide that a quiet moment should stay quiet.

Use Vox in either of two ways:

- **Vox Cloud** — open the hosted webpage and sign in with an activation code.
- **Personal desktop** — run Vox locally with your own OpenAI and TypeSafe API keys. Personal mode does not use the Vox backend or Vox provider tokens.

## Quick start

### Option A: use Vox Cloud

1. Open [Vox Cloud](https://vox-assistant.ericcheng306.workers.dev/).
2. Enter your email address and activation code.
3. Allow microphone access when your browser asks.
4. Select **Start talking**.

Cloud access currently requires an invitation. The hosted service manages its own AI usage, encrypted conversation sync, preferences, memory, reminders, and files.

### Option B: install Personal mode on macOS

Personal mode is the privacy-first, bring-your-own-keys version. The current tested desktop build is for macOS on Apple Silicon.

#### What you need

- [Node.js](https://nodejs.org/) 22.13 or newer, which includes `npm`
- Git
- An OpenAI API key; follow the [official OpenAI quickstart](https://developers.openai.com/api/docs/quickstart), then create it in the [API dashboard](https://platform.openai.com/api-keys)
- A TypeSafe API key from the [TypeSafe console](https://console.typesafe.ai/)
- Optional: a local Codex installation if you want coding delegation or Computer Use

OpenAI API usage is billed separately from ChatGPT subscriptions. TypeSafe usage is billed by TypeSafe. Vox does not charge a monthly fee for Personal mode.

#### 1. Download and build Vox

Open Terminal and run:

```bash
git clone https://github.com/EricCheng2222/vox-ambient-assistant.git
cd vox-ambient-assistant
npm ci
npm --prefix desktop/VoxDesktop ci
npm --prefix desktop/VoxDesktop run dist
```

When the build finishes, the installer is here:

```text
desktop/VoxDesktop/dist/Vox-0.2.1-arm64.dmg
```

#### 2. Install the app

1. Open `Vox-0.2.1-arm64.dmg`.
2. Drag **Vox** into **Applications**.
3. Open Vox from Applications.

The current community build is not signed or notarized. If macOS blocks the first launch, try opening Vox once, then go to **System Settings → Privacy & Security** and choose **Open Anyway** for Vox. Only do this for a build you created yourself from this repository.

#### 3. Configure Personal mode

1. Choose **Personal** on the connection screen.
2. Paste a newly generated OpenAI API key.
3. Paste your TypeSafe API key.
4. Select **Save and continue**.
5. Allow microphone access. Camera access is optional and frames are sent only when you ask Vox to look.

Long-lived keys stay in the desktop main process and are encrypted with the operating system’s secure storage. The interface receives only a short-lived OpenAI Realtime credential. Do not put real keys in source files, screenshots, issues, or `.env.example`.

#### 4. Optional: connect local Codex

Vox can pass an explicit local task to Codex and can request Computer Use for installed applications. Codex keeps its own sign-in and permission boundary; Vox does not read or copy Codex credentials.

Install and sign in to Codex separately, then grant only the macOS permissions needed for the apps you want it to control. Ordinary voice conversation does not require Codex.

## Connection modes

| Mode | AI billing | Sign-in | Data location | Available surfaces |
| --- | --- | --- | --- | --- |
| **Vox Cloud** | Managed by Vox; a subscription may be introduced later with notice | Activation code + email | Encrypted cloud conversation, preferences, memory, reminders, and files | Web and desktop |
| **Personal** | User pays OpenAI and TypeSafe directly; no Vox monthly fee | User’s OpenAI and TypeSafe API keys, plus optional local Codex sign-in | Provider keys and conversation preferences remain on the device | Desktop only |

Personal mode loads a locally bundled copy of the interface and rejects every local `/api/*` cloud request. Its AI traffic goes directly from the desktop app to OpenAI and TypeSafe, while Codex tasks stay behind the local Codex boundary.

Personal mode currently keeps the transcript and preferences on one device. Cloud memory, cross-device sync, hosted files, reminders, and invite codes are intentionally unavailable because those features require the Vox backend.

## Main features

- Interruptible OpenAI Realtime speech-to-speech conversation
- TypeSafe Jev routing for when to wait, speak, use vision, control an app, or delegate to Codex
- Mandarin transcription with Traditional Chinese and Taiwan-language response guidance
- User-selectable voice, reply-length preference, initiative, and visual theme
- On-request camera frames with a visible capture effect and no continuous image upload
- Natural response-length variance and conversational-move selection, so advice is not the default
- Optional cloud memory, reminders, generated files, invitations, and cross-device transcript sync
- Desktop-local Codex and constrained Computer Use integration

## Troubleshooting

| Problem | What to try |
| --- | --- |
| Personal mode is missing | Personal mode is available only in the desktop app, not on the hosted webpage. |
| Vox rejects an API key | Create a new key in the provider dashboard, copy it without extra spaces, and replace the saved key. |
| Microphone does not work | Open **System Settings → Privacy & Security → Microphone** and allow Vox, then restart the app. |
| Camera does not work | Enable Vox under **Privacy & Security → Camera**. Camera access is optional. |
| macOS says the developer cannot be verified | Use **Privacy & Security → Open Anyway** only for a build you made from this repository. |
| Codex or Computer Use is unavailable | Confirm that local Codex is installed and signed in, then check its local app permissions. |
| The app says a provider budget is exhausted | Add provider credit or wait for the provider limit to reset. Personal mode uses your own provider accounts. |

## Development

### Web and cloud development

1. Copy `.env.example` to `.env.local`.
2. Replace every placeholder with a development-only value. Never commit `.env.local`.
3. Install dependencies and start the local server:

```bash
npm ci
npm run dev
```

Production Cloud deployment uses Cloudflare Workers, D1, and private R2. See [DEPLOYMENT.md](./DEPLOYMENT.md) for resource creation, secrets, migrations, privacy boundaries, and deployment commands.

### Run the desktop shell during development

Start the web interface in one Terminal window:

```bash
npm run dev
```

Then start the desktop shell in another:

```bash
cd desktop/VoxDesktop
npm ci
VOX_DESKTOP_DEV_URL=http://localhost:5173 npm start
```

## Architecture

- `app/` — web interface and Vox Cloud API routes
- `lib/` — shared routing, language, memory, privacy, and conversation policies
- `desktop/VoxDesktop/` — Electron shell, local Codex bridge, secure Personal-mode provider bridge, and locally bundled web server
- `ios/` — early iOS shell sharing the cloud backend contract
- `migrations/` — Cloudflare D1 schema
- `scripts/` — tests and deployment preparation

## Security model

- Cloud sessions use signed, expiring, HttpOnly cookies scoped to opaque user IDs.
- Activation codes are hashed; email addresses and synchronized transcript messages are encrypted before D1 storage.
- Generated file bodies stay in private R2.
- Personal provider keys are encrypted locally and are never returned to the renderer.
- Personal-mode provider requests originate in the desktop main process.
- Computer actions are limited by local policy, installed-app resolution, and the Codex sandbox.
- Secrets, local state, build output, and installers are excluded from Git.
- GitHub secret scanning and push protection are enabled for this repository.

Report vulnerabilities privately as described in [SECURITY.md](./SECURITY.md). Never put credentials or personal transcripts in public issues.

## Tests

```bash
npm run lint
npm run build
npm run test:privacy
npm --prefix desktop/VoxDesktop run check
```

Additional focused test scripts are listed in the root `package.json`.

## Contributing

Noncommercial contributions are welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md) and [CLA.md](./CLA.md) before opening a pull request.

## License

Vox is source-available under the [PolyForm Noncommercial License 1.0.0](./LICENSE). Personal study, experimentation, modification, and other permitted noncommercial uses are welcome. Commercial use requires a separate written license from Eric Cheng.
