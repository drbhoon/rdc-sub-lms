-- Token usage per AI interaction, used to enforce the per-learner, per-course
-- spend cap. Nullable so existing rows (which predate metering) simply count
-- as zero rather than blocking anyone.
ALTER TABLE "CourseAiInteraction" ADD COLUMN "inputTokens" INTEGER;
ALTER TABLE "CourseAiInteraction" ADD COLUMN "outputTokens" INTEGER;
