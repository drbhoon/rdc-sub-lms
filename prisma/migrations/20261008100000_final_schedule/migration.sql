-- The final assessment no longer opens by itself. An admin schedules it for a
-- classroom, each learner gets one attempt, and an admin can allow another.
-- Additive: no schedule exists until one is made, so the final is closed to
-- everyone until then, which is the point.

-- AlterTable
ALTER TABLE "Enrollment" ADD COLUMN     "finalAdminOpened" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "finalAttemptsAllowed" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "FinalAssessmentSchedule" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "classroomId" TEXT,
    "opensAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinalAssessmentSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinalAssessmentSchedule_courseId_idx" ON "FinalAssessmentSchedule"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "FinalAssessmentSchedule_courseId_classroomId_key" ON "FinalAssessmentSchedule"("courseId", "classroomId");

-- AddForeignKey
ALTER TABLE "FinalAssessmentSchedule" ADD CONSTRAINT "FinalAssessmentSchedule_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinalAssessmentSchedule" ADD CONSTRAINT "FinalAssessmentSchedule_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
