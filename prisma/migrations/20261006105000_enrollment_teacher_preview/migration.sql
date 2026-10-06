-- Marks an enrolment that is a teacher looking at their own course, so it can be
-- left out of learner counts, rosters, toppers, reports and reminders.
-- Additive: every existing enrolment is an ordinary one (false).

-- AlterTable
ALTER TABLE "Enrollment" ADD COLUMN     "isTeacherPreview" BOOLEAN NOT NULL DEFAULT false;
