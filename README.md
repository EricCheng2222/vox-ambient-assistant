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
desktop/VoxDesktop/dist/Vox-0.3.0-arm64.dmg
```

#### 2. Install the app

1. Open `Vox-0.3.0-arm64.dmg`.
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

#### 5. Optional: connect a local Dyson purifier

Open **Home** in Vox Desktop and choose **Discover**. The purifier must already be connected to the same Wi-Fi network as the Mac.

- Older supported models can use the purifier label’s `DYSON-…` setup network name and printed Wi-Fi code. Vox derives the local device credential and does not retain the printed code.
- Newer supported models require the purifier’s local device credential, serial number, and product type. Vox never asks for or stores the MyDyson account password.

After pairing, voice commands can turn the purifier on or off, set speed 1–10, toggle auto/night/oscillation, and read available local sensor status. Heat controls and filter resets are deliberately excluded from this first version.

Smart-home execution is desktop-only and local-first: device credentials are encrypted with macOS secure storage and device traffic stays on the LAN. A command spoken directly to Vox Desktop does not pass through the Vox backend. When a paired phone explicitly routes an action to the Mac, the backend relays only an end-to-end encrypted command envelope and never receives the device credential or plaintext command. Dyson is the first adapter behind a general smart-home hub boundary intended to support more local device types later.

#### 6. Optional: pair the phone web app with your Mac

Phone control is available only when Vox Desktop uses **Vox Cloud** and the phone is signed in to the same Vox account.

1. Open **Pair phone** in Vox Desktop.
2. Choose **Create pairing QR code**, then scan the private, short-lived QR code with your phone camera. If scanning is unavailable, use **Copy link instead**.
3. Open the scanned page on the phone and choose **Pair securely**.
4. Wait for the Mac to show **Phone connected**.
5. On the phone, open **Route** in the header and explicitly choose **Paired Mac**.

Pairing does not enable Mac routing by itself. The phone defaults to **Web only**, and the selected route remains visible in the header. In **Paired Mac** mode, supported app actions, smart-home commands, folder opening, and approved read-only Codex tasks travel through the paired Mac. Normal conversation, web search, reminders, files, and cloud memory continue to use the web service.

The QR code is generated locally inside Vox Desktop and encodes a pairing link carrying a random device key in its URL fragment, which browsers do not send to the server. No third-party QR service sees it. Commands and results are AES-256-GCM encrypted on the endpoints; D1 stores only ciphertext. The Mac rejects expired and replayed command IDs and applies its local app, smart-home, sandbox, and confirmation policies after decryption. Revoke the phone from **Pair phone** on the Mac to delete the relay queue and invalidate its local key.

#### 7. Optional: private realtime telephone assistant

Vox Cloud can use a Twilio number as a deliberately limited telephone surface. The preferred path is Direct SIP: Twilio keeps the phone number, OpenAI Realtime carries the encrypted live audio, and the Vox backend keeps authentication, memory, transcript sync, reminders, and call policy on a private sideband connection. This removes the old listen-transcribe-wait-speak loop and makes the call behave much more like the continuous web voice session.

Configure `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `TWILIO_WEBHOOK_BASE_URL`, `OPENAI_SIP_PROJECT_ID`, and `OPENAI_WEBHOOK_SECRET`. Keep the Twilio number's incoming voice webhook at `POST https://your-vox-domain.example/api/twilio/voice`. In the OpenAI project, subscribe a signed webhook at `POST https://your-vox-domain.example/api/openai/realtime-sip` to `realtime.call.incoming`. The Cloudflare deployment adds a per-call Durable Object so the private OpenAI sideband remains alive for the call.

The phone surface is exclusive to the master/owner account; invited members cannot see or configure it. The owner chooses a private spoken sentence from **Call Vox**. Vox stores only a keyed hash of a normalized transcription—not the sentence or a voiceprint. Incoming callers may use any phone but must say the exact sentence. The Realtime model is locked to an authentication-only prompt until Vox verifies that transcript; a failure ends the call, repeated failures are rate-limited by a keyed caller fingerprint, unauthenticated calls time out after two minutes, and authenticated calls end after ten quiet minutes. The sentence is transcribed by OpenAI and should not be reused from another account or spoken where somebody else can hear it.

An E.164 callback number is optional. When supplied, it is encrypted at rest and is used only for a call the owner asked for: an immediate test call, or a reminder the owner marked for phone-call delivery. Caller phone numbers never identify or authenticate an account.

The realtime call shares the selected Vox voice, concise memory, and bounded recent conversation with the web app; completed caller and Vox transcripts are encrypted into the same synced conversation. It supports conversation, factual questions, creating reminders, and listing pending reminders. It cannot control the paired Mac or smart home, contact another person, send a message, purchase, delete, log in, or disclose private data. Outbound calls are off by default. Once the owner turns on calls from Vox, they can also mark individual reminders for phone-call delivery—from the phone button in **Reminders**, or by asking, such as “call me at three to remind me.” Vox then phones the owner's callback number when the reminder is due and reads it aloud. Vox never calls anyone else; autonomous check-ins and third-party calls are not enabled. Call recording is not requested or stored by Vox.

## Connection modes

| Mode | AI billing | Sign-in | Data location | Available surfaces |
| --- | --- | --- | --- | --- |
| **Vox Cloud** | Managed by Vox; a subscription may be introduced later with notice | Activation code + email | Encrypted cloud conversation, preferences, memory, reminders, and files | Web and desktop |
| **Personal** | User pays OpenAI and TypeSafe directly; no Vox monthly fee | User’s OpenAI and TypeSafe API keys, plus optional local Codex sign-in | Provider keys and conversation preferences remain on the device | Desktop only |

Vox Desktop always loads its bundled interface, including in Cloud mode. Cloud mode reaches the account APIs through a locked local gateway; the hosted server never supplies executable interface code to the privileged desktop window. Personal mode rejects every cloud API request. Its AI traffic goes directly from the desktop app to OpenAI and TypeSafe, while Codex tasks stay behind the local Codex boundary.

Personal mode currently keeps the transcript and preferences on one device. Cloud memory, cross-device sync, hosted files, reminders, and invite codes are intentionally unavailable because those features require the Vox backend.

The interface labels the scopes explicitly:

- **Account · Vox Cloud** — reply length, voice, initiative, theme, transcript, memory, reminders, and files that synchronize through the signed-in account.
- **Device · This Mac** — API keys, Codex workspace, installed-app access, Computer Use, macOS permissions, and smart-home credentials. Account data can never enable or widen these local capabilities.
- **Route · Web only / Paired Mac** — a phone-web choice that determines whether local-capability requests remain unavailable or are sent through its encrypted pairing. Pairing alone never changes this choice.

## Main features

- Interruptible OpenAI Realtime speech-to-speech conversation
- TypeSafe Jev routing for when to wait, speak, use vision, control an app, or delegate to Codex
- Mandarin transcription with Traditional Chinese and Taiwan-language response guidance
- User-selectable voice, reply-length preference, initiative, and visual theme
- On-request camera frames with a visible capture effect and no continuous image upload
- Natural response-length variance and conversational-move selection, so advice is not the default
- Always-on bounded conversation continuity: Vox keeps recent dialogue available instead of asking the router whether to include it
- Optional cloud memory, reminders, generated files, invitations, and cross-device transcript sync
- Desktop-local Codex and constrained Computer Use integration
- Desktop-local smart-home hub with an initial Dyson Wi-Fi purifier adapter
- Explicit phone-web routing to a securely paired Mac

## Conversation context and memory

Vox treats an uncleared conversation as one continuous dialogue, including after a voice connection ends and reconnects. Recent transcript history is seeded into the new Realtime conversation, so short follow-ups such as “continue” or “what about that?” can refer naturally to the preceding exchange. Topic changes no longer cause the router to discard context; using **Clear** is the explicit way to reset the conversation.

To bound cost and prevent unlimited growth, OpenAI Realtime receives a rolling maximum of **8,000 post-instruction input tokens**. When that window is exceeded, the service drops the oldest conversation items and retains 80% of the window to reduce repeated truncation. Router and presence decisions receive a bounded recent transcript of at most 24 messages and 12,000 characters.

Cloud memory is separate from this short-term context window. Vox stores concise memory summaries rather than copying whole transcript passages. Jev receives eligible saved-memory summaries and decides whether the current moment calls for a natural callback, an emotional follow-up, or no explicit memory reference. Cooldowns and social eligibility still apply, and saved facts may be used silently when strictly needed to answer the current request. Personal mode remains independent of the Vox backend and therefore does not use Cloud memory.

## Troubleshooting

| Problem | What to try |
| --- | --- |
| Personal mode is missing | Personal mode is available only in the desktop app, not on the hosted webpage. |
| Vox rejects an API key | Create a new key in the provider dashboard, copy it without extra spaces, and replace the saved key. |
| Microphone does not work | Open **System Settings → Privacy & Security → Microphone** and allow Vox, then restart the app. |
| Camera does not work | Enable Vox under **Privacy & Security → Camera**. Camera access is optional. |
| macOS says the developer cannot be verified | Use **Privacy & Security → Open Anyway** only for a build you made from this repository. |
| Codex or Computer Use is unavailable | Confirm that local Codex is installed and signed in, then check its local app permissions. |
| The phone shows Mac offline | Keep Vox Desktop running in Cloud mode, confirm both devices use the same Vox account, and wait a few seconds for the encrypted relay heartbeat. |
| A paired phone does not control the Mac | In Vox Desktop, open **Phone control** and enable remote control until Vox quits. Then, on the phone, open **Route** and explicitly choose **Paired Mac**. Pairing alone grants no control. |
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
- `desktop/VoxDesktop/` — Electron shell, local Codex bridge, secure Personal-mode provider bridge, local smart-home hub, and bundled web server
- `ios/` — early iOS shell sharing the cloud backend contract
- `migrations/` — Cloudflare D1 schema
- `scripts/` — tests and deployment preparation

## Security model

- Cloud sessions use signed, expiring, HttpOnly cookies scoped to opaque user IDs.
- The packaged desktop never executes JavaScript delivered by Vox Cloud. A per-process secret binds its allowlisted API gateway to the current desktop renderer, and cloud session cookies are attached only by Electron's main process.
- Cloud routing cannot create local authority: Computer Use, Codex, workspace access, camera capture, and smart-home commands require independently detected local user intent and local policy checks.
- Phone-to-Mac pairing uses a unique 256-bit endpoint key that is never stored in D1. The relay sees device IDs, timing metadata, and ciphertext, but not command or result contents. The Mac enforces expiry, replay prevention, local capability policy, and native confirmation for remote Codex tasks.
- Activation codes are hashed; email addresses and synchronized transcript messages are encrypted before D1 storage.
- Generated file bodies stay in private R2.
- Personal provider keys are encrypted locally and are never returned to the renderer.
- Personal-mode provider requests originate in the desktop main process.
- Smart-home credentials are encrypted with operating-system secure storage; commands stay on the local network.
- Computer actions are limited by local policy, installed-app resolution, and the Codex sandbox.
- Secrets, local state, build output, and installers are excluded from Git.
- GitHub secret scanning and push protection are enabled for this repository.

Report vulnerabilities privately as described in [SECURITY.md](./SECURITY.md). Never put credentials or personal transcripts in public issues.

## Tests

```bash
npm run lint
npm run build
npm run test:privacy
npm run test:remote-control
npm --prefix desktop/VoxDesktop run check
```

Additional focused test scripts are listed in the root `package.json`.

## Contributing

Noncommercial contributions are welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md) and [CLA.md](./CLA.md) before opening a pull request.

## License

Vox is source-available under the [PolyForm Noncommercial License 1.0.0](./LICENSE). Personal study, experimentation, modification, and other permitted noncommercial uses are welcome. Commercial use requires a separate written license from Eric Cheng.
