-- AlterTable
ALTER TABLE "answers" ADD COLUMN     "late_by_seconds" INTEGER;

-- AlterTable
ALTER TABLE "questions" ADD COLUMN     "question_deadline" TIMESTAMP(3);
