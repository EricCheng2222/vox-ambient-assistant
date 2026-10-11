# Vox Flash Cards

An independent flash-card site and remote MCP server. People sign in with their **Vox account** (“Sign in with Vox”), manage decks and cards here, and connect MCP clients. Vox uses this server to study with them by voice; Claude, ChatGPT, and other MCP apps can connect too.

- `GET /`: the editor (decks, cards, connected apps)
- `POST /mcp`: the MCP server (Streamable HTTP, JSON). It exposes `list_decks`, `create_deck`, `update_deck`, `delete_deck`, `list_cards`, `add_cards`, `edit_card`, `delete_card`, `next_card`, `grade_card`, `skip_card`, `grade_cards` (single-review compatibility alias), and `study_stats`.
- OAuth for MCP clients: `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`, `/oauth/register`, `/oauth/authorize`, `/oauth/token`
- Sign in with Vox: `/auth/login`, `/auth/callback`

Study has one outstanding card per account, persisted in D1 across clients and requests. `next_card` resumes that card until `grade_card` or `skip_card` completes it. Both require the returned `card_id` and `review_id`; stale or repeated tokens cannot record another review. Grade/skip and scheduling commit atomically, then return the next card. Bulk grading is rejected. Stopping a session leaves the card available to resume, with no fabricated grade or automatic skip. `list_cards` remains a browsing/editing tool, not a study queue.

## Develop

```bash
npx wrangler d1 migrations apply DB --local --config flashcards-site/wrangler.jsonc
npm run flashcards:dev
npm run flashcards:typecheck
```

Set `VOX_URL` to your Vox instance, for example `--var VOX_URL:http://127.0.0.1:8799` when both run locally.

## Deploy

See “Vox Flash Cards” in `DEPLOYMENT.md`.
