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

This project is experimental software. Review the code and provider data policies before using it with sensitive conversations or granting computer-control access.
