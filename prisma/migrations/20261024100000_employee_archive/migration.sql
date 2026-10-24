-- Archive: people who left, or were replaced by a newer record, move out of the active list.
ALTER TABLE "Employee" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Employee" ADD COLUMN "archiveReason" TEXT;
CREATE INDEX "Employee_archivedAt_idx" ON "Employee"("archivedAt");
