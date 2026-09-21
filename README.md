# Vox ambient voice assistant

Vox is a continuous, interruptible browser voice assistant. OpenAI Realtime handles speech-to-speech conversation and semantic voice activity detection. TypeSafe Jev acts as a fast router for every utterance and as a presence classifier that can decide when Vox should speak first during a quiet stretch.

Jev can select seven paths:

- `silence` — background speech or utterances that should not receive a reply
- `realtime` — ordinary low-latency voice conversation
- `balanced_reasoning` — deeper answers with GPT-5.6 Terra
- `expert_reasoning` — difficult or high-stakes work with GPT-6 Astra
- `live_web` — current information with web search
- `create_reminder` — extract a future time and save a persistent reminder
- `create_file` — generate and save a downloadable note, checklist, report, data file, web page, or code file

The initiative control sets how readily Vox may speak without being prompted. The browser checks for a useful moment only while the live session is quiet and idle; Jev has a strong bias toward `stay_silent`, and the app enforces cooldowns and a per-session cap so presence does not turn into chatter.

Mandarin speech is transcribed without translation and guided toward Traditional Chinese as used in Taiwan. Mandarin responses—including proactive check-ins and answers prepared by deeper models—use Taiwan vocabulary, phrasing, and conversational pacing. Substantive English input still receives an English response.

Vox receives an authoritative UTC clock plus the current date and time in `Asia/Taipei`. The clock is refreshed immediately before each typed or spoken response, and it is also available to JEV presence decisions, reasoning routes, and generated files.

Natural-language reminders are stored in D1. While the app is open, Vox polls for due reminders, shows an in-app alert, can raise a browser notification after the user enables permission, and speaks the reminder when an idle voice session is connected. Closed-app background delivery requires a future push, email, or messaging integration.

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Add an OpenAI API key and a TypeSafe Jev API key.
3. Run `npm run dev`.

Both long-lived API keys remain server-side. The browser receives only a short-lived OpenAI Realtime credential. Memory metadata is stored in Cloudflare D1, while generated file contents are stored in a private R2 bucket.

## Production readiness

The app is configured as a standalone Cloudflare Worker; it is not tied to ChatGPT Sites. Production deployment uses a D1 database, an R2 bucket, and a private access-code screen. See [DEPLOYMENT.md](./DEPLOYMENT.md) for the setup and deployment checklist.
