-- DropIndex
DROP INDEX "FeedbackResponse_formId_employeeId_key";

-- AlterTable
ALTER TABLE "FeedbackResponse" ADD COLUMN     "courseContentId" TEXT;

-- CreateIndex
CREATE INDEX "FeedbackResponse_courseContentId_idx" ON "FeedbackResponse"("courseContentId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackResponse_formId_employeeId_courseContentId_key" ON "FeedbackResponse"("formId", "employeeId", "courseContentId");

-- AddForeignKey
ALTER TABLE "FeedbackResponse" ADD CONSTRAINT "FeedbackResponse_courseContentId_fkey" FOREIGN KEY ("courseContentId") REFERENCES "CourseContent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

