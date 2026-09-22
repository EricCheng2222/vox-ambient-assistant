# Vox

Vox is a source-available, continuous voice companion for the web and desktop. It is designed around natural pauses rather than rigid turns: people can hesitate, continue a thought, interrupt a reply, or let Vox decide that a quiet moment should stay quiet.

The desktop app also provides an explicit bridge to the user’s own local Codex installation and constrained computer control for installed apps.

## Connection modes

| Mode | AI billing | Sign-in | Data location | Available surfaces |
| --- | --- | --- | --- | --- |
| **Vox Cloud** | Managed by the Vox service; a subscription may be introduced later with notice | Activation code + email | Encrypted cloud conversation, preferences, memory, reminders, and files | Web and desktop |
| **Personal** | The user pays OpenAI and TypeSafe directly; Vox charges no monthly fee | User’s own OpenAI and TypeSafe API keys + their existing local Codex sign-in | Keys encrypted with Electron `safeStorage`; conversation and preferences remain on the device | Desktop only |

Personal mode is deliberately isolated from Vox Cloud. The desktop app loads a locally bundled copy of the interface, rejects every local `/api/*` cloud request, and contacts only OpenAI, TypeSafe, and local Codex for AI work. Long-lived provider keys remain in the desktop main process; the webpage receives only a short-lived OpenAI Realtime client secret.

Codex authentication is separate. Vox neither reads nor copies Codex credentials; Codex continues to use the user’s existing local ChatGPT or API-key sign-in.

## Highlights

- Interruptible OpenAI Realtime speech-to-speech conversation
- TypeSafe Jev routing for when to wait, speak, use vision, control an app, or delegate to Codex
- Mandarin transcription with Traditional Chinese and Taiwan-language response guidance
- User-selectable voice, reply-length preference, initiative, and visual theme
- On-request camera frames with a visible capture effect and no continuous image upload
- Natural response-length variance and conversation-move selection, so advice is not the default
- Optional cloud memory, reminders, generated files, invitations, and cross-device transcript sync
- Desktop-local Codex and constrained Computer Use integration

## Personal desktop setup

Personal mode is the simplest way to run Vox without the hosted backend:

1. Build the web bundle and desktop app:

   ```bash
   cd desktop/VoxDesktop
   npm ci
   npm run dist
   ```

2. Install the generated desktop build.
3. Choose **Personal** at launch.
4. Enter an OpenAI API key and a TypeSafe API key. Both are encrypted by the operating system-backed secure storage.
5. Sign in to local Codex separately if you want Vox to delegate coding or computer-use tasks.

Personal mode currently keeps the live transcript and preferences on that device. Cloud memory, cross-device sync, hosted files, reminders, and invite codes are intentionally disabled because enabling them would contact the Vox server.

## Vox Cloud local development

1. Copy `.env.example` to `.env.local`.
2. Add development OpenAI and TypeSafe keys plus the local access configuration.
3. Install dependencies and start the app:

   ```bash
   npm ci
   npm run dev
   ```

Long-lived cloud provider keys stay server-side. Browsers receive only short-lived OpenAI Realtime credentials.

Cloud production uses Cloudflare Workers, D1, and private R2. See [DEPLOYMENT.md](./DEPLOYMENT.md) for resource creation, secrets, migrations, privacy boundaries, and deployment commands.

## Architecture

- `app/` — Next/Vinext interface and cloud API routes
- `lib/` — shared routing, language, memory, privacy, and conversation policies
- `desktop/VoxDesktop/` — Electron desktop shell, local Codex bridge, secure Personal-mode provider bridge, and locally bundled web server
- `ios/` — early iOS shell sharing the cloud backend contract
- `migrations/` — Cloudflare D1 schema
- `scripts/` — tests and deployment preparation

## Security model

- Cloud sessions are signed, expiring, HttpOnly cookies scoped to opaque user IDs.
- Activation codes are hashed; email addresses and synchronized transcript messages are encrypted before D1 storage.
- Generated file bodies stay in private R2.
- Personal provider keys are encrypted locally and are never returned to the renderer.
- Personal-mode provider requests originate in the desktop main process.
- Computer actions are limited by local policy, installed-app resolution, and the Codex sandbox.
- Secrets, build output, local state, and installers are excluded from Git.

Please report vulnerabilities privately as described in [SECURITY.md](./SECURITY.md). Do not put credentials or personal transcripts in public issues.

## Tests

```bash
npm run lint
npm run build
npm run test:privacy
cd desktop/VoxDesktop && npm run check
```

Additional focused test scripts are listed in the root `package.json`.

## Contributing

Noncommercial contributions are welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md) and [CLA.md](./CLA.md) before opening a pull request.

## License

Vox is source-available under the [PolyForm Noncommercial License 1.0.0](./LICENSE). Personal study, experimentation, modification, and other permitted noncommercial uses are welcome. Commercial use requires a separate written license from Eric Cheng.
