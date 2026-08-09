import { createCertificatePdf } from "@/lib/certificate-pdf";
import { getCertificateRecord } from "@/lib/certificate-record";
import { currentUser } from "@/lib/session";

export const runtime = "nodejs";

function filenamePart(value: string) {
  return value.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "course";
}

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!user.employeeId) return new Response("Certificate not available", { status: 404 });

  const { id } = await context.params;
  const certificate = await getCertificateRecord(user.employeeId, id);
  if (!certificate) return new Response("Certificate not available", { status: 404 });

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
