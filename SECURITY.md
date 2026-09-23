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
- The phone proves knowledge of the key with HMAC-SHA-256. Commands and results use AES-256-GCM with device- and command-specific associated data. D1 contains only opaque ciphertext plus routing metadata.
- Commands expire after two minutes. The Mac records processed command IDs locally before execution so a replayed or restored relay record cannot repeat an action.
- The relay cannot bypass the Mac's installed-app resolution, blocked-action policy, Codex sandbox, or native confirmation for remote Codex tasks. Revoking a pairing removes its relay queue and deletes the Mac's local key.
- A database or relay-only compromise cannot decrypt or forge a paired command. A compromise of the hosted JavaScript origin while the user has the web app open is a broader supply-chain threat: the browser origin can access its own saved pairing state. The Mac's local policy and native confirmations remain the final boundary. High-risk actions are intentionally unsupported rather than delegated to the relay.

This project is experimental software. Review the code and provider data policies before using it with sensitive conversations or granting computer-control access.
