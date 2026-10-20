-- Where each employee came from, and when the sync last found them in the master.
ALTER TABLE "Employee" ADD COLUMN "source" TEXT;
ALTER TABLE "Employee" ADD COLUMN "masterSeenAt" TIMESTAMP(3);
