-- Course kinds (standard / SCORM / instructor-led), YouTube and text lessons, reels, SCORM attempts and ILT sessions.
-- Additive: every existing course stays STANDARD and nothing existing changes.

-- CreateEnum
CREATE TYPE "CourseKind" AS ENUM ('STANDARD', 'SCORM', 'ILT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ContentType" ADD VALUE 'YOUTUBE';
ALTER TYPE "ContentType" ADD VALUE 'SCORM';
ALTER TYPE "ContentType" ADD VALUE 'ILT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LessonType" ADD VALUE 'YOUTUBE';
ALTER TYPE "LessonType" ADD VALUE 'SCORM';
ALTER TYPE "LessonType" ADD VALUE 'ILT';

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "kind" "CourseKind" NOT NULL DEFAULT 'STANDARD';

-- AlterTable
ALTER TABLE "Lesson" ADD COLUMN     "body" TEXT,
ADD COLUMN     "externalRef" TEXT;

-- CreateTable
CREATE TABLE "CourseReel" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "caption" TEXT,
    "storedKey" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "youtubeId" TEXT,
    "durationSeconds" INTEGER,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseReel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReelView" (
    "id" TEXT NOT NULL,
    "reelId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "watchedSeconds" INTEGER NOT NULL DEFAULT 0,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "firstViewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastViewedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReelView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScormAttempt" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "completionStatus" TEXT NOT NULL DEFAULT 'not attempted',
    "successStatus" TEXT NOT NULL DEFAULT 'unknown',
    "lessonStatus" TEXT,
    "scoreRaw" DOUBLE PRECISION,
    "scoreMin" DOUBLE PRECISION,
    "scoreMax" DOUBLE PRECISION,
    "location" TEXT,
    "suspendData" TEXT,
    "totalSeconds" INTEGER NOT NULL DEFAULT 0,
    "suspended" BOOLEAN NOT NULL DEFAULT false,
    "finished" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCommitAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resetAt" TIMESTAMP(3),

    CONSTRAINT "ScormAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IltSession" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "classroomId" TEXT,
    "title" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 60,
    "meetUrl" TEXT NOT NULL,
    "instructorName" TEXT,
    "notes" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "invitationsSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IltSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IltAttendance" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "joinedClickAt" TIMESTAMP(3),
    "markedById" TEXT,
    "markedAt" TIMESTAMP(3),

    CONSTRAINT "IltAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourseReel_courseId_order_idx" ON "CourseReel"("courseId", "order");

-- CreateIndex
CREATE INDEX "ReelView_employeeId_idx" ON "ReelView"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "ReelView_reelId_employeeId_key" ON "ReelView"("reelId", "employeeId");

-- CreateIndex
CREATE INDEX "ScormAttempt_lessonId_idx" ON "ScormAttempt"("lessonId");

-- CreateIndex
CREATE UNIQUE INDEX "ScormAttempt_enrollmentId_lessonId_attemptNumber_key" ON "ScormAttempt"("enrollmentId", "lessonId", "attemptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "IltSession_lessonId_key" ON "IltSession"("lessonId");

-- CreateIndex
CREATE INDEX "IltSession_courseId_startsAt_idx" ON "IltSession"("courseId", "startsAt");

-- CreateIndex
CREATE INDEX "IltAttendance_enrollmentId_idx" ON "IltAttendance"("enrollmentId");

-- CreateIndex
CREATE UNIQUE INDEX "IltAttendance_sessionId_enrollmentId_key" ON "IltAttendance"("sessionId", "enrollmentId");

-- AddForeignKey
ALTER TABLE "CourseReel" ADD CONSTRAINT "CourseReel_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReelView" ADD CONSTRAINT "ReelView_reelId_fkey" FOREIGN KEY ("reelId") REFERENCES "CourseReel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReelView" ADD CONSTRAINT "ReelView_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScormAttempt" ADD CONSTRAINT "ScormAttempt_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScormAttempt" ADD CONSTRAINT "ScormAttempt_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IltSession" ADD CONSTRAINT "IltSession_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IltSession" ADD CONSTRAINT "IltSession_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IltAttendance" ADD CONSTRAINT "IltAttendance_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "IltSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IltAttendance" ADD CONSTRAINT "IltAttendance_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

