CREATE TYPE "CourseEmailType" AS ENUM ('ENROLLMENT', 'REMINDER');
CREATE TYPE "CourseEmailStatus" AS ENUM ('SENT', 'FAILED', 'SKIPPED');
CREATE TYPE "CourseAiInteractionStatus" AS ENUM ('ANSWERED', 'FAILED');

CREATE TABLE "CourseAiInteraction" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "status" "CourseAiInteractionStatus" NOT NULL DEFAULT 'ANSWERED',
    "error" TEXT,
    "model" TEXT,
    "sourceRestricted" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseAiInteraction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CourseEmailLog" (
    "id" TEXT NOT NULL,
    "type" "CourseEmailType" NOT NULL,
    "status" "CourseEmailStatus" NOT NULL,
    "courseId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "error" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseEmailLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CourseAiInteraction_courseId_createdAt_idx" ON "CourseAiInteraction"("courseId", "createdAt");
CREATE INDEX "CourseAiInteraction_employeeId_createdAt_idx" ON "CourseAiInteraction"("employeeId", "createdAt");
CREATE INDEX "CourseEmailLog_type_sentAt_idx" ON "CourseEmailLog"("type", "sentAt");
CREATE INDEX "CourseEmailLog_courseId_type_sentAt_idx" ON "CourseEmailLog"("courseId", "type", "sentAt");
CREATE INDEX "CourseEmailLog_employeeId_type_sentAt_idx" ON "CourseEmailLog"("employeeId", "type", "sentAt");

ALTER TABLE "CourseAiInteraction" ADD CONSTRAINT "CourseAiInteraction_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseAiInteraction" ADD CONSTRAINT "CourseAiInteraction_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseEmailLog" ADD CONSTRAINT "CourseEmailLog_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseEmailLog" ADD CONSTRAINT "CourseEmailLog_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
