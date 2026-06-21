# RDC Subsidiary LMS

Mobile-first learning management system for RDC subsidiary companies. This repository currently implements the approved first milestone: employee administration, email OTP access, role-aware course management, teacher approval, content processing, enrollment, lesson playback, and server-authoritative progress.

## Architecture

- Next.js and TypeScript modular monolith
- PostgreSQL with Prisma
- Database-backed, hashed session tokens
- Local/Railway-volume storage behind a storage interface
- Independent content-processing worker
- LibreOffice, Poppler, and FFmpeg for PowerPoint, PDF, and MP4 inspection

Azure Blob support, tests/certificates, AI learning, reports, reminders, and leaderboards belong to later approved milestones.

## Local setup

Prerequisites: Node.js 24, PostgreSQL, LibreOffice, Poppler tools (`pdftoppm`, `pdftotext`), and FFmpeg/FFprobe.

1. Copy `.env.example` to `.env` and supply the PostgreSQL and SMTP settings.
2. Set exactly two comma-separated addresses in `SUPER_ADMIN_EMAILS`.
3. Run `npm ci`.
4. Run `npm run db:deploy` and `npm run db:seed`.
5. Run `npm run dev` in one terminal and `npm run worker` in another.

OTP values are never logged. A functional SMTP configuration is required to sign in.

## Employee import

CSV and Excel files must contain these exact headings:

- Employee Code
- Name
- Email
- Company
- Department
- Designation
- Status

`Manager Name` and `Mobile Number` are optional. Re-importing the same employee code updates the record. Setting status to `INACTIVE` revokes existing sessions.

## Railway deployment

Create PostgreSQL and one application service from this repository. During the Railway-volume testing phase, the web and worker processes intentionally run in the same service because Railway volumes are service-scoped.

- Application start command: `npm run db:deploy && npm run start:railway`
- Attach one persistent volume to the application service at the path configured by `STORAGE_ROOT`.
- Configure all variables from `.env.example`; `SMTP_FROM` should remain `RDC Learning <noreply@rdc.in>`.
- Run `npm run db:seed` once after the first migration.

Do not scale the application beyond one instance while using local volume storage. Web and worker processes can become separate services after migration to shared Azure Blob storage.

## Verification

```text
npm run typecheck
npm run lint
npm test
npm run build
npm audit
```
