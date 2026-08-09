import Image from "next/image";
import { notFound } from "next/navigation";
import { getCertificateRecord } from "@/lib/certificate-record";
import { requireUser } from "@/lib/session";
import { withBase } from "@/lib/base-path";

export default async function CertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!user.employeeId) notFound();
  const certificate = await getCertificateRecord(user.employeeId, id);
  if (!certificate) notFound();

  return <main className="certificate-page">
    <section className="certificate-card">
      <Image src={withBase("/brand/rdc-logo.jpeg")} alt="RDC logo" width={180} height={109} />
      <p className="certificate-company">RDC Concrete (India) Limited</p>
      <h1>Certificate of Completion</h1>
      <p>This certifies that</p>
      <h2>{certificate.employeeName}</h2>
      <p>Employee Code: {certificate.employeeCode}</p>
      <p>has successfully completed</p>
      <h3>{certificate.courseTitle}</h3>
      <p>on {certificate.completedAt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p>
      <div className="certificate-footer">
        <span>Company: {certificate.companyName}</span>
        <span>Certificate ID: {certificate.certificateId}</span>
      </div>
    </section>
    <div className="certificate-actions">
      <a className="button" href={withBase(`/api/courses/${id}/certificate`)}>Download certificate PDF</a>
      <span>Or use browser print to print the certificate.</span>
    </div>
  </main>;
}
