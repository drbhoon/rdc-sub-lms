import Image from "next/image";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";

export default async function CertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!user.employeeId) notFound();
  const enrollment = await db.enrollment.findUnique({
    where: { employeeId_courseId: { employeeId: user.employeeId, courseId: id } },
    include: { employee: { include: { company: true } }, course: true },
  });
  if (!enrollment || !enrollment.completedAt || !enrollment.course.certificateEnabled || enrollment.course.status !== "PUBLISHED") notFound();
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
