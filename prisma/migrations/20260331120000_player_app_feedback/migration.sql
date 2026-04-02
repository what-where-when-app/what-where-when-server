-- SQUASHED migration for player app feedback.
-- Final shape:
-- - nullable game_id / participant_id (home-screen anonymous feedback)
-- - JSONB payload
-- This replaces older incremental migrations for the feedback feature.

DO $$
BEGIN
  IF to_regclass('public.player_app_feedback') IS NULL THEN
    CREATE TABLE "player_app_feedback" (
      "id" SERIAL NOT NULL,
      "game_id" INTEGER,
      "participant_id" INTEGER,
      "payload" JSONB NOT NULL DEFAULT '{}',
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "player_app_feedback_pkey" PRIMARY KEY ("id")
    );
  ELSE
    -- Ensure final columns exist
    ALTER TABLE "player_app_feedback"
      ADD COLUMN IF NOT EXISTS "payload" JSONB NOT NULL DEFAULT '{}';

    -- Make ids optional
    ALTER TABLE "player_app_feedback"
      ALTER COLUMN "game_id" DROP NOT NULL;
    ALTER TABLE "player_app_feedback"
      ALTER COLUMN "participant_id" DROP NOT NULL;

    -- Drop legacy columns if they exist
    ALTER TABLE "player_app_feedback"
      DROP COLUMN IF EXISTS "rating",
      DROP COLUMN IF EXISTS "liked_tags",
      DROP COLUMN IF EXISTS "improve_tags",
      DROP COLUMN IF EXISTS "comment",
      DROP COLUMN IF EXISTS "locale";
  END IF;

  -- Index (idempotent)
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'player_app_feedback_game_id_idx'
  ) THEN
    CREATE INDEX "player_app_feedback_game_id_idx" ON "player_app_feedback"("game_id");
  END IF;

  -- Foreign keys (best-effort; don't fail if already present)
  BEGIN
    ALTER TABLE "player_app_feedback"
      ADD CONSTRAINT "player_app_feedback_game_id_fkey"
      FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;

  BEGIN
    ALTER TABLE "player_app_feedback"
      ADD CONSTRAINT "player_app_feedback_participant_id_fkey"
      FOREIGN KEY ("participant_id") REFERENCES "game_participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END $$;

