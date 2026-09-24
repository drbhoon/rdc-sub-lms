-- Weighted course results: module quizzes, an optional teacher assessment and
-- a final assessment drawn from every module, weighted by an admin to total 100.
-- Additive only: existing assessments become MODULE, nothing is rewritten.

-- CreateEnum
CREATE TYPE "AssessmentKind" AS ENUM ('MODULE', 'FINAL');

-- AlterTable
ALTER TABLE "Assessment" ADD COLUMN     "builtFromAssessmentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "kind" "AssessmentKind" NOT NULL DEFAULT 'MODULE';

-- CreateTable
CREATE TABLE "CourseGrading" (
    "courseId" TEXT NOT NULL,
    "teacherAssessmentEnabled" BOOLEAN NOT NULL DEFAULT false,
    "teacherWeight" INTEGER NOT NULL DEFAULT 0,
    "finalWeight" INTEGER NOT NULL DEFAULT 0,
    "moduleWeights" JSONB NOT NULL DEFAULT '{}',
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseGrading_pkey" PRIMARY KEY ("courseId")
);

-- CreateTable
CREATE TABLE "TeacherEvaluation" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "teacherUserId" TEXT,
    "score" INTEGER NOT NULL,
    "comments" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeacherEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeacherEvaluation_teacherUserId_idx" ON "TeacherEvaluation"("teacherUserId");

-- CreateIndex
CREATE UNIQUE INDEX "TeacherEvaluation_courseId_employeeId_key" ON "TeacherEvaluation"("courseId", "employeeId");

-- AddForeignKey
ALTER TABLE "CourseGrading" ADD CONSTRAINT "CourseGrading_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherEvaluation" ADD CONSTRAINT "TeacherEvaluation_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherEvaluation" ADD CONSTRAINT "TeacherEvaluation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherEvaluation" ADD CONSTRAINT "TeacherEvaluation_teacherUserId_fkey" FOREIGN KEY ("teacherUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

