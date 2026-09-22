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

This project is experimental software. Review the code and provider data policies before using it with sensitive conversations or granting computer-control access.
