import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { CertificateRecord } from "@/lib/certificate-record";

const A4_LANDSCAPE: [number, number] = [841.89, 595.28];
const navy = rgb(18 / 255, 35 / 255, 63 / 255);
const green = rgb(0, 166 / 255, 81 / 255);
const muted = rgb(82 / 255, 96 / 255, 115 / 255);

async function embedCertificateFont(document: PDFDocument) {
  const candidates = process.platform === "win32"
    ? ["C:\\Windows\\Fonts\\arial.ttf", "C:\\Windows\\Fonts\\calibri.ttf"]
    : [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
      ];

  document.registerFontkit(fontkit);
  for (const candidate of candidates) {
    try {
      return { font: await document.embedFont(await readFile(/* turbopackIgnore: true */ candidate), { subset: true }), unicode: true };
    } catch {
      // Try the next system font before falling back to PDF's built-in font.
    }
  }
  return { font: await document.embedFont(StandardFonts.Helvetica), unicode: false };
}

function safeText(value: string, unicode: boolean) {
  return unicode ? value : value.replace(/[^\x20-\x7E]/g, "?");
}

function centeredText(page: PDFPage, text: string, y: number, size: number, font: PDFFont, color = navy) {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (page.getWidth() - width) / 2, y, size, font, color });
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const proposed = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(proposed, size) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = proposed;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function centeredWrappedText(page: PDFPage, text: string, y: number, size: number, font: PDFFont, maxWidth: number, color = navy) {
  const lines = wrapText(text, font, size, maxWidth);
  lines.forEach((line, index) => centeredText(page, line, y - index * (size + 6), size, font, color));
  return y - Math.max(1, lines.length) * (size + 6);
}

export async function createCertificatePdf(record: CertificateRecord) {
  const document = await PDFDocument.create();
  document.setTitle(`Certificate of Completion - ${record.courseTitle}`);
  document.setAuthor("RDC Concrete (India) Limited");
  document.setCreator("RDC Learning");
  document.setCreationDate(new Date());

  const page = document.addPage(A4_LANDSCAPE);
  const { width, height } = page.getSize();
  page.drawRectangle({ x: 18, y: 18, width: width - 36, height: height - 36, borderColor: navy, borderWidth: 8 });
  page.drawRectangle({ x: 31, y: 31, width: width - 62, height: height - 62, borderColor: green, borderWidth: 2 });

  const { font, unicode } = await embedCertificateFont(document);
  const clean = (value: string) => safeText(value, unicode);

  try {
    const logoPath = path.join(/* turbopackIgnore: true */ process.cwd(), "public", "brand", "rdc-logo.jpeg");
    const logo = await document.embedJpg(await readFile(/* turbopackIgnore: true */ logoPath));
    const scaled = logo.scaleToFit(118, 74);
    page.drawImage(logo, { x: (width - scaled.width) / 2, y: height - 112, width: scaled.width, height: scaled.height });
  } catch {
    // The certificate remains usable if the optional image asset cannot be read.
  }

  centeredText(page, "RDC CONCRETE (INDIA) LIMITED", 446, 14, font, navy);
  centeredText(page, "CERTIFICATE OF COMPLETION", 392, 31, font, navy);
  centeredText(page, "This certifies that", 349, 14, font, muted);
  centeredWrappedText(page, clean(record.employeeName), 306, 27, font, width - 170, green);
  centeredText(page, clean(`Employee Code: ${record.employeeCode}`), 261, 12, font, muted);
  centeredText(page, "has successfully completed", 226, 14, font, muted);
  centeredWrappedText(page, clean(record.courseTitle), 183, 23, font, width - 160, navy);
  centeredText(
    page,
    clean(`Completed on ${record.completedAt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`),
    116,
    12,
    font,
    muted,
  );

  page.drawLine({ start: { x: 65, y: 88 }, end: { x: width - 65, y: 88 }, thickness: 0.8, color: rgb(0.82, 0.85, 0.89) });
  page.drawText(clean(`Company: ${record.companyName}`), { x: 65, y: 63, size: 10, font, color: muted });
  const certificateLabel = clean(`Certificate ID: ${record.certificateId}`);
  page.drawText(certificateLabel, {
    x: width - 65 - font.widthOfTextAtSize(certificateLabel, 10),
    y: 63,
    size: 10,
    font,
    color: muted,
  });

  return document.save();
}
