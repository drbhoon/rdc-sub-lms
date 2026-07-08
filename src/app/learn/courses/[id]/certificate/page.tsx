import Image from "next/image";
import { notFound } from "next/navigation";
import { certificateEligibility } from "@/lib/certificate-eligibility";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";

export default async function CertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!user.employeeId) notFound();
  const enrollment = await db.enrollment.findUnique({
    where: { employeeId_courseId: { employeeId: user.employeeId, courseId: id } },
    include: {
      employee: { include: { company: true } },
      progress: true,
      course: {
        include: {
          contents: {
            where: { isPublished: true },
            include: { lessons: { where: { approvedAt: { not: null } } } },
          },
          assessments: {
            where: { status: "ACTIVE" },
            include: { attempts: { where: { employeeId: user.employeeId, status: "SUBMITTED", passed: true }, take: 1 } },
            take: 1,
          },
          feedbackForms: {
            where: { isActive: true },
            include: { responses: { where: { employeeId: user.employeeId }, take: 1 } },
            take: 1,
          },
        },
      },
    },
  });
  if (!enrollment || !enrollment.completedAt || !enrollment.course.certificateEnabled || enrollment.course.status !== "PUBLISHED") notFound();
  const lessonIds = new Set(enrollment.course.contents.flatMap((content) => content.lessons.map((lesson) => lesson.id)));
  const totalLessons = lessonIds.size;
  const completedLessons = enrollment.progress.filter((progress) => lessonIds.has(progress.lessonId) && progress.completedAt).length;
  const activeAssessment = enrollment.course.assessments[0];
  const activeFeedbackForm = enrollment.course.feedbackForms[0];
  const certificate = certificateEligibility({
    certificateEnabled: enrollment.course.certificateEnabled,
    totalLessons,
    completedLessons,
    courseCompleted: Boolean(enrollment.completedAt),
    hasActiveAssessment: Boolean(activeAssessment),
    hasPassedAssessment: Boolean(activeAssessment?.attempts.length),
    hasActiveFeedbackForm: Boolean(activeFeedbackForm),
    hasSubmittedFeedback: Boolean(activeFeedbackForm?.responses.length),
  });
  if (!certificate.ready) notFound();
  const certificateId = `${enrollment.courseId.slice(-4)}-${enrollment.id.slice(-6)}`.toUpperCase();

  return <main className="certificate-page">
    <section className="certificate-card">
      <Image src="/brand/rdc-logo.jpeg" alt="RDC logo" width={180} height={109} />
      <p className="certificate-company">RDC Concrete (India) Limited</p>
      <h1>Certificate of Completion</h1>
      <p>This certifies that</p>
      <h2>{enrollment.employee.name}</h2>
      <p>Employee Code: {enrollment.employee.employeeCode}</p>
      <p>has successfully completed</p>
      <h3>{enrollment.course.title}</h3>
      <p>on {enrollment.completedAt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p>
      <div className="certificate-footer">
        <span>Company: {enrollment.employee.company.name}</span>
        <span>Certificate ID: {certificateId}</span>
      </div>
    </section>
    <p className="certificate-actions">Use browser print to save this certificate as PDF.</p>
  </main>;
}
