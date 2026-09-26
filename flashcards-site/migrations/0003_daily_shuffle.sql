-- A fresh random order each study day, and "seen today" so a card doesn't
-- come back until every other due card has had its turn.
ALTER TABLE cards ADD COLUMN seen_at TEXT;
ALTER TABLE cards ADD COLUMN shuffle_key REAL;
ALTER TABLE cards ADD COLUMN shuffle_day TEXT;
-- Minutes east of UTC for the owner's study day (Taipei by default).
ALTER TABLE users ADD COLUMN utc_offset INTEGER NOT NULL DEFAULT 480;
