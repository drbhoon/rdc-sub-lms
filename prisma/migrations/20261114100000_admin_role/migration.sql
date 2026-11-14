-- A middle tier between Super Admin and Teacher: uploads courses, assigns them and downloads reports.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'ADMIN';
