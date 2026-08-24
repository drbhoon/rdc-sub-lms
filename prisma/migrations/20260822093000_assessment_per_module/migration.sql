-- DropIndex
DROP INDEX "Assessment_courseId_version_key";

-- AlterTable
ALTER TABLE "Assessment" ADD COLUMN     "courseContentId" TEXT;

-- CreateIndex
CREATE INDEX "Assessment_courseContentId_idx" ON "Assessment"("courseContentId");

-- CreateIndex
CREATE UNIQUE INDEX "Assessment_courseId_courseContentId_version_key" ON "Assessment"("courseId", "courseContentId", "version");

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_courseContentId_fkey" FOREIGN KEY ("courseContentId") REFERENCES "CourseContent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

