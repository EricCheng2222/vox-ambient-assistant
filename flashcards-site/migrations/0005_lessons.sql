-- Textbook-style lessons: each covers one topic of a deck, as a few slides,
-- and cards link to the lesson that teaches them.
CREATE TABLE lessons (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  deck_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  content TEXT NOT NULL, -- JSON array of slides
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_lessons_owner_deck ON lessons (owner_id, deck_id, position);
ALTER TABLE cards ADD COLUMN lesson_id TEXT;
