-- Cards shown since a missed card last came back, for "every 10 new cards,
-- repeat one missed card" (reset each study day).
ALTER TABLE users ADD COLUMN since_repeat INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN since_repeat_day TEXT;
