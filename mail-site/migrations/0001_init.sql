-- Vox Mail: an independent site that signs users in with their Vox account,
-- connects their email accounts, and serves them to MCP clients such as Vox.

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

-- The user's email accounts (several per Vox user): Gmail and Microsoft
-- through OAuth, anything else through IMAP + SMTP. `secret` is the OAuth
-- refresh token or the IMAP app password, AES-GCM encrypted with
-- MAIL_TOKEN_SECRET and bound to the user and account id.
CREATE TABLE mail_accounts (
  id TEXT PRIMARY KEY,            -- short random id, part of every message id
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,         -- gmail | microsoft | imap
  email TEXT NOT NULL,
  secret TEXT NOT NULL,           -- ciphertext (base64url)
  iv TEXT NOT NULL,
  scope TEXT NOT NULL,            -- granted OAuth scopes; empty for IMAP
  config TEXT NOT NULL,           -- JSON: IMAP/SMTP servers; {} for OAuth
  status TEXT NOT NULL,           -- connected | disconnected (revoked, expired, or password changed)
  is_primary INTEGER NOT NULL DEFAULT 0,
  access_token TEXT,              -- ciphertext of the current OAuth access token
  access_iv TEXT,
  access_expires_at TEXT,
  connected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_mail_accounts_user_email ON mail_accounts (user_id, email);

-- In-flight "Connect Google/Microsoft" requests, bound to the signed-in user and browser.
CREATE TABLE connect_states (
  state_hash TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  user_id TEXT NOT NULL,
  browser_hash TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  return_to TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- An app's pending authorization request, parked while the user adds an
-- email account; pages carry only the random nonce.
CREATE TABLE pending_returns (
  nonce_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  return_to TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

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
