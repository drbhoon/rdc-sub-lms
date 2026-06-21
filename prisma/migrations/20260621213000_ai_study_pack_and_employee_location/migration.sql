ALTER TABLE "Employee" ADD COLUMN "locationPlant" TEXT;

ALTER TABLE "CourseContent"
ADD COLUMN "quizQuestions" JSONB,
ADD COLUMN "aiModel" TEXT,
ADD COLUMN "aiGeneratedAt" TIMESTAMP(3);
