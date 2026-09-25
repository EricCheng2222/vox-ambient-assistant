-- One row per graded review, for statistics: activity, streaks, accuracy.
CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  deck_id TEXT NOT NULL,
  rating TEXT NOT NULL CHECK (rating IN ('again', 'hard', 'good', 'easy')),
  interval_before REAL NOT NULL,
  interval_after REAL NOT NULL,
  reviewed_at TEXT NOT NULL
);
CREATE INDEX idx_reviews_owner_time ON reviews (owner_id, reviewed_at);
CREATE INDEX idx_reviews_owner_deck ON reviews (owner_id, deck_id);
