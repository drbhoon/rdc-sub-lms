-- A Meet link made by the LMS through Google Calendar keeps its event id, so rescheduling or cancelling changes the same event.
ALTER TABLE "IltSession" ADD COLUMN "googleEventId" TEXT;

-- Who has been e-mailed the link of a session, learners and teachers alike.
CREATE TABLE "IltInvitation" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IltInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IltInvitation_sessionId_email_key" ON "IltInvitation"("sessionId", "email");

ALTER TABLE "IltInvitation" ADD CONSTRAINT "IltInvitation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "IltSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
