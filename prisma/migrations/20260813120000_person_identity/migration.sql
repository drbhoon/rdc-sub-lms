-- Link every LMS employee to the shared person spine in the portal, so a
-- learner's course record can be read alongside their appraisal, their DISC
-- profile and their assessments.
--
-- Nullable on purpose. LMS is the one app that legitimately serves people who
-- are NOT on the employee master — off-roll staff and third-party learners —
-- and an employee added before the portal could resolve them must keep working.
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "personId" TEXT;

CREATE INDEX IF NOT EXISTS "Employee_personId_idx" ON "Employee"("personId");
