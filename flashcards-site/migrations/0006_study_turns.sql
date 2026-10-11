-- One outstanding study card per account, across MCP requests and clients.
-- The token identifies one presentation, including repeats of the same card.
CREATE TABLE study_turns (
  owner_id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  review_id TEXT NOT NULL,
  deck_id TEXT,
  focus TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'graded', 'skipped'))
);
