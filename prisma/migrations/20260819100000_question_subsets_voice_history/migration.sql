ALTER TABLE "Assessment" ADD COLUMN "questionsPerAttempt" INTEGER;

ALTER TABLE "CourseAiInteraction"
  ADD COLUMN "inputAudioTokens" INTEGER,
  ADD COLUMN "outputAudioTokens" INTEGER,
  ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'TEXT',
  ADD COLUMN "language" TEXT;

