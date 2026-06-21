# RDC Subsidiary LMS

Mobile-first learning management system for RDC subsidiary companies. It includes employee administration, email OTP access, role-aware course management, AI-assisted teacher review, content processing, enrollment, lesson playback, and server-authoritative progress.

## Architecture

- Next.js and TypeScript modular monolith
- PostgreSQL with Prisma
- Database-backed, hashed session tokens
- Local/Railway-volume storage behind a storage interface
- Independent content-processing worker
- OpenAI Responses API study packs with structured summaries and teacher-only review questions/answers
- LibreOffice, Poppler, and FFmpeg for PowerPoint, PDF, and MP4 inspection

Azure Blob support, tests/certificates, reports, reminders, and leaderboards belong to later approved milestones.

## Local setup

Prerequisites: Node.js 24, PostgreSQL, LibreOffice, Poppler tools (`pdftoppm`, `pdftotext`), and FFmpeg/FFprobe.

1. Copy `.env.example` to `.env` and supply the PostgreSQL, SMTP and OpenAI settings.
2. Set exactly two comma-separated addresses in `SUPER_ADMIN_EMAILS`.
3. Run `npm ci`.
4. Run `npm run db:deploy` and `npm run db:seed`.
5. Run `npm run dev` in one terminal and `npm run worker` in another.

OTP values are never logged. A functional SMTP configuration is required to sign in.

## Employee import

Download the Excel or CSV template from the Employees page. Required headings:

- `EMP_CODE`
- `EMP_NAME`
- `EMAIL`
- `COMPANY`
- `DESIGNATION`

Optional headings are `LOCATION_PLANT`, `DEPARTMENT`, `STATUS`, `MANAGER_NAME`, and `MOBILE_NUMBER`. Department defaults to `General`; status defaults to `ACTIVE`. Re-importing the same `EMP_CODE` updates the record. Setting status to `INACTIVE` revokes existing sessions. Legacy headings remain accepted.

## Railway deployment

Create PostgreSQL and one application service from this repository. During the Railway-volume testing phase, the web and worker processes intentionally run in the same service because Railway volumes are service-scoped.

- Application start command: `npm run start:railway`
- Attach one persistent volume to the application service at the path configured by `STORAGE_ROOT`.
- Configure all variables from `.env.example`; `SMTP_FROM` should remain `RDC Learning <noreply@rdc.in>`.
- Startup runs the idempotent Super Admin seed after migrations.

Do not scale the application beyond one instance while using local volume storage. Web and worker processes can become separate services after migration to shared Azure Blob storage.

## Verification

```text
npm run typecheck
npm run lint
npm test
npm run build
npm audit
```
