-- An AI reference file (aiOnly) can belong to one video module. Deleting the module removes its reference too.
ALTER TABLE "CourseContent" ADD COLUMN "referenceForId" TEXT;
CREATE INDEX "CourseContent_referenceForId_idx" ON "CourseContent"("referenceForId");
ALTER TABLE "CourseContent" ADD CONSTRAINT "CourseContent_referenceForId_fkey" FOREIGN KEY ("referenceForId") REFERENCES "CourseContent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
