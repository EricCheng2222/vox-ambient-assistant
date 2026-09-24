# Security policy

## Reporting a vulnerability

Please do not publish exploitable details, API keys, activation codes, private transcripts, or screenshots containing personal data in a public issue.

Use GitHub’s private vulnerability-reporting feature for this repository. Include the affected version, a minimal reproduction, the expected impact, and any suggested mitigation. You should receive an acknowledgement within seven days.

## Supported version

Security fixes currently target the latest commit on `main` and the latest desktop release.

## Credential handling

- Never commit `.env` files, Cloudflare credentials, OpenAI keys, TypeSafe keys, Codex authentication files, activation codes, or exported production data.
- Rotate a credential immediately if it appears in a commit, issue, log, screenshot, or chat.
- Personal-mode keys must remain inside the desktop main process and encrypted storage. New renderer APIs must not return them.
- Cloud provider keys must remain server-side and must never be embedded in a client bundle.

## Desktop trust boundary

- Packaged releases load only the bundled Vox interface in the privileged desktop view. Cloud mode uses an allowlisted local API gateway instead of loading the hosted webpage.
- The gateway is bound to the current renderer with a random per-process secret. It strips renderer cookies, authorization headers, the binding secret, and upstream `Set-Cookie` headers.
- Account synchronization may change conversational preferences and cloud data, but it cannot grant macOS permissions or enable Computer Use, Codex, installed-app, camera, or smart-home access.
- Local-capability routes require fresh intent detected from the user's own request. Treat cloud routing output and cloud content as untrusted suggestions.

## Phone-to-Mac pairing

- Pairing is available only to the same authenticated Vox Cloud account on both endpoints. Pairing never changes the phone's action route: the user must explicitly select **Paired Mac** instead of **Web only**.
- Each Mac pairing uses an independent random 256-bit key. The Mac keeps its copy in operating-system secure storage. The phone receives its copy in a URL fragment, which is not included in HTTP requests, and removes the fragment after claiming the pairing.
- The phone browser keeps its pairing key in session storage, not persistent local storage. Closing that browser session requires pairing again. This reduces the time in which a later hosted-page compromise could reach an old key.
- The phone proves knowledge of the key with HMAC-SHA-256. Commands and results use AES-256-GCM with device- and command-specific associated data. D1 contains only opaque ciphertext plus routing metadata.
- Commands expire after two minutes. The Mac records processed command IDs locally before execution so a replayed or restored relay record cannot repeat an action.
- Pairing does not itself authorize execution. Vox Desktop starts with remote control paused after every launch. The user must enable it locally; it then remains enabled until manually paused or Vox quits. This is intentionally a local, memory-only authority flag.
- The relay cannot bypass the Mac's installed-app resolution, blocked-action policy, Codex sandbox, or native confirmation for remote Codex tasks. Revoking a pairing removes its relay queue and deletes the Mac's local key.
- A database or relay-only compromise cannot decrypt or forge a paired command. A full hosted-origin compromise while the phone web app is open is a broader supply-chain threat: same-origin JavaScript can use session-held pairing authority. The local enable switch, command expiry, installed-app checks, blocked-action policy, and native confirmations remain the final boundaries. High-risk actions are intentionally unsupported rather than delegated to the relay.

## Telephone assistant

- Telephone access is separate from phone-to-Mac pairing and is restricted to the master/owner Vox account. Invited users cannot configure it, and inbound phrase matching accepts only the owner's record. Incoming Twilio requests and OpenAI project webhooks must pass their provider signature checks. The per-call Durable Object owns one OpenAI sideband and deduplicates the accept decision.
- The private sentence is a knowledge factor, not speaker biometrics. Vox stores only a keyed hash of its normalized transcription—not the sentence or a voiceprint. Before verification, Realtime response generation is disabled and the session has authentication-only instructions; no memory, conversation carryover, or tools are supplied. Users should choose an uncommon sentence and avoid speaking it where others can hear.
- Caller phone numbers do not identify or authenticate an account. Vox uses a keyed caller fingerprint only to rate-limit repeated failures. An optional callback number is encrypted at rest and is used only for explicitly requested outbound calls. Vox requests no call recording and stores no telephone audio.
- Direct SIP sends live call audio from Twilio to OpenAI using TLS/SRTP. After authentication, completed transcripts are encrypted with the same conversation key used by the web app. Unauthenticated calls time out after two minutes; authenticated calls end after ten quiet minutes and their authorization record has a two-hour hard expiry.
- Telephone calls default to cloud conversation and reminders. After the authenticated caller explicitly switches the call to the Mac, the call may request the same locally constrained app, smart-home, workspace, and read-only Codex capabilities as the paired-phone route. The Mac must be paired, online, and locally enabled. Phone-derived envelopes are accepted only for the `phone_mac` route; they cannot inject lower-level command kinds directly.
- The phone authentication sentence necessarily passes through the call service during verification. A full live call-service compromise could derive the phone-to-Mac envelope key, so telephone authentication is not an end-to-end defense against a hostile cloud runtime. The local enable switch and Mac-side capability policy are mandatory containment boundaries.
- Calls from Vox are disabled by default. The initial implementation permits only a signed-in user's immediate test call; autonomous check-ins and third-party calls are not enabled.

This project is experimental software. Review the code and provider data policies before using it with sensitive conversations or granting computer-control access.
