CREATE TABLE IF NOT EXISTS ir_events (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL,
  protocol TEXT,
  manufacturer TEXT,
  model TEXT,
  request_json TEXT NOT NULL,
  response_json TEXT NOT NULL,
  raw_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_ir_events_created_at ON ir_events(created_at DESC);
