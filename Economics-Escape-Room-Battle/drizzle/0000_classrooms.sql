CREATE TABLE rooms (
  code TEXT PRIMARY KEY,
  host_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting',
  seconds INTEGER NOT NULL DEFAULT 75,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE players (
  id TEXT PRIMARY KEY,
  room TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,
  token_hash TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  elapsed INTEGER NOT NULL DEFAULT 0,
  round_correct INTEGER NOT NULL DEFAULT 0,
  question_start INTEGER,
  feedback TEXT,
  history TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  UNIQUE(room, name)
);
--> statement-breakpoint
CREATE INDEX players_room ON players(room);
