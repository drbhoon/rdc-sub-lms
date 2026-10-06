-- A teacher is now enrolled on every course they teach, marked as a preview so
-- they are not counted as a learner, to see the course the way a learner does.
-- From here on that happens when the teacher is assigned; this brings the
-- teachers already assigned into line.
--
-- Additive and idempotent: nobody is removed, nobody already enrolled is
-- touched, and no e-mail is sent. A teacher with no employee record (a Super
-- Admin who is not on the master) has nothing to enrol and is skipped.
INSERT INTO "Enrollment" ("id", "employeeId", "courseId", "isTeacherPreview")
SELECT 'c' || md5(random()::text || clock_timestamp()::text || ct."courseId" || ct."userId"),
       u."employeeId",
       ct."courseId",
       true
FROM "CourseTeacher" ct
JOIN "User" u ON u."id" = ct."userId"
JOIN "Employee" e ON e."id" = u."employeeId"
WHERE e."status" = 'ACTIVE'
ON CONFLICT ("employeeId", "courseId") DO NOTHING;
