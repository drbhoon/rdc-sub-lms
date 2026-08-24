-- DropIndex
DROP INDEX "FeedbackForm_courseId_version_key";

-- AlterTable
ALTER TABLE "FeedbackForm" ADD COLUMN     "courseContentId" TEXT;

-- CreateIndex
CREATE INDEX "FeedbackForm_courseContentId_idx" ON "FeedbackForm"("courseContentId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackForm_courseId_courseContentId_version_key" ON "FeedbackForm"("courseId", "courseContentId", "version");

-- AddForeignKey
ALTER TABLE "FeedbackForm" ADD CONSTRAINT "FeedbackForm_courseContentId_fkey" FOREIGN KEY ("courseContentId") REFERENCES "CourseContent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

