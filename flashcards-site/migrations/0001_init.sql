-- Vox Flash Cards: an independent site that signs users in with their Vox
-- account and serves their cards to MCP clients such as Vox, Claude, and ChatGPT.

CREATE TABLE users (
  id TEXT PRIMARY KEY,            -- pairwise account id issued by Vox
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_login_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions (user_id);

-- In-flight "Sign in with Vox" requests: the PKCE verifier and the browser
-- that started the sign-in are bound to the state.
CREATE TABLE login_states (
  state_hash TEXT PRIMARY KEY,
  browser_hash TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  return_to TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- This site's own registration as an OAuth client of Vox.
CREATE TABLE vox_client (
  issuer TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE decks (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_decks_owner_name ON decks (owner_id, name);

CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  deck_id TEXT NOT NULL,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  notes TEXT,
  ease REAL NOT NULL DEFAULT 2.5,
  interval_days REAL NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  due_at TEXT NOT NULL,
  last_reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_cards_owner_deck ON cards (owner_id, deck_id);
CREATE INDEX idx_cards_owner_due ON cards (owner_id, due_at);

-- OAuth for MCP clients (dynamic registration, PKCE, rotating refresh tokens).
CREATE TABLE oauth_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE oauth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE oauth_tokens (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,             -- access | refresh
  grant_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX idx_oauth_tokens_owner ON oauth_tokens (owner_id);
CREATE INDEX idx_oauth_tokens_grant ON oauth_tokens (grant_id);
