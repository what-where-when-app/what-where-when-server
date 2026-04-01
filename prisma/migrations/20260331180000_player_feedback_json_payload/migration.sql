-- AlterTable: store feedback as a single JSON document
ALTER TABLE "player_app_feedback" ADD COLUMN "payload" JSONB NOT NULL DEFAULT '{}';

UPDATE "player_app_feedback"
SET "payload" = jsonb_build_object(
  'rating', "rating",
  'likedTags', to_jsonb("liked_tags"),
  'improveTags', to_jsonb("improve_tags"),
  'comment', "comment",
  'locale', to_jsonb("locale")
);

ALTER TABLE "player_app_feedback"
  DROP COLUMN "rating",
  DROP COLUMN "liked_tags",
  DROP COLUMN "improve_tags",
  DROP COLUMN "comment",
  DROP COLUMN "locale";
