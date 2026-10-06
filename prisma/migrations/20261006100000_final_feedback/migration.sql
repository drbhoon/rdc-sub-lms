-- Feedback on the final assessment. A feedback form was always about one module
-- (or, for a legacy form, answered once per module). The final assessment has no
-- module, so a form needs a kind to say it is about the final. Additive only:
-- every existing form becomes MODULE, which is what it already was.

-- AlterTable
ALTER TABLE "FeedbackForm" ADD COLUMN     "kind" "AssessmentKind" NOT NULL DEFAULT 'MODULE';
