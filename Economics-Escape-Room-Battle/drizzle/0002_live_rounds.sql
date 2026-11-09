ALTER TABLE rooms ADD COLUMN phase TEXT NOT NULL DEFAULT 'lobby';
--> statement-breakpoint
ALTER TABLE rooms ADD COLUMN question_index INTEGER NOT NULL DEFAULT -1;
--> statement-breakpoint
ALTER TABLE rooms ADD COLUMN round_start INTEGER;
