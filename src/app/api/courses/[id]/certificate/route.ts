import { createCertificatePdf } from "@/lib/certificate-pdf";
import { getCertificateRecord } from "@/lib/certificate-record";
import { audit } from "@/lib/audit";
import { hasEffectiveRole } from "@/lib/roles";
import { currentUser } from "@/lib/session";

export const runtime = "nodejs";

function filenamePart(value: string) {
  return value.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "course";
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  // A learner downloads their own. An administrator can download any learner's (?employee=), under the
  // same conditions the learner faces, so a certificate cannot be had that the learner could not get.
  // Not while viewing a learner's account: there you are that learner, not the administrator.
  const requested = new URL(request.url).searchParams.get("employee");
  const forOther = Boolean(requested && requested !== user.employeeId);
  if (forOther && (user.viewingAs || !hasEffectiveRole(user, "SUPER_ADMIN"))) return new Response("Forbidden", { status: 403 });
  const employeeId = forOther ? requested : user.employeeId;
  if (!employeeId) return new Response("Certificate not available", { status: 404 });

  const { id } = await context.params;
  const certificate = await getCertificateRecord(employeeId, id);
  if (!certificate) {
    return new Response(forOther
      ? "Certificate not available: this learner has not finished the course, or has not yet met every certificate condition (module quizzes, feedback, and the pass marks of the course scheme)."
      : "Certificate not available", { status: 404 });
  }
  if (forOther) await audit(user.id, "CERTIFICATE_DOWNLOADED_BY_ADMIN", "Employee", employeeId, { courseId: id, certificateId: certificate.certificateId });

  const pdf = await createCertificatePdf(certificate);
  const filename = `RDC-certificate-${filenamePart(certificate.employeeCode)}-${filenamePart(certificate.courseTitle)}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
