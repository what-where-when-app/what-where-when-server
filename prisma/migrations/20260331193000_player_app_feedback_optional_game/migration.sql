-- Standalone feedback from the app home screen (no active game / participant)
ALTER TABLE "player_app_feedback" ALTER COLUMN "game_id" DROP NOT NULL;
ALTER TABLE "player_app_feedback" ALTER COLUMN "participant_id" DROP NOT NULL;
