# Vox Flash Cards

An independent flash-card site and remote MCP server. People sign in with their **Vox account** (“Sign in with Vox”), manage decks and cards here, and connect MCP clients. Vox uses this server to study with them by voice; Claude, ChatGPT, and other MCP apps can connect too.

- `GET /`: the editor (decks, cards, connected apps)
- `POST /mcp`: the MCP server (Streamable HTTP, stateless JSON). It exposes `list_decks`, `create_deck`, `update_deck`, `delete_deck`, `list_cards`, `add_cards`, `edit_card`, `delete_card`, `next_card`, `grade_card`, and `study_stats`.
- OAuth for MCP clients: `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`, `/oauth/register`, `/oauth/authorize`, `/oauth/token`
- Sign in with Vox: `/auth/login`, `/auth/callback`

## Develop

```bash
npx wrangler d1 migrations apply DB --local --config flashcards-site/wrangler.jsonc
npm run flashcards:dev
npm run flashcards:typecheck
```

Set `VOX_URL` to your Vox instance, for example `--var VOX_URL:http://127.0.0.1:8799` when both run locally.

## Deploy

See “Vox Flash Cards” in `DEPLOYMENT.md`.
