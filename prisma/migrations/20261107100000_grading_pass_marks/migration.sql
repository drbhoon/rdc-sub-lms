-- The conditions for a certificate: each part of the weighted result has a pass mark, and so does the total.
ALTER TABLE "CourseGrading" ADD COLUMN "overallPassPercent" INTEGER NOT NULL DEFAULT 75,
ADD COLUMN "passMarks" JSONB NOT NULL DEFAULT '{}';
