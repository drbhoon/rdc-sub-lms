import path from "node:path";
import { randomUUID } from "node:crypto";
import { ContentType } from "@prisma/client";
import { env } from "@/lib/env";
import { matchesFileSignature } from "@/lib/file-signatures";

const allowed = new Map([
  [".pdf", { mime: ["application/pdf"], type: ContentType.PDF }],
  [".ppt", { mime: ["application/vnd.ms-powerpoint", "application/octet-stream"], type: ContentType.PRESENTATION }],
  [".pptx", { mime: ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/zip"], type: ContentType.PRESENTATION }],
  [".mp4", { mime: ["video/mp4", "application/octet-stream"], type: ContentType.VIDEO }],
]);

export function validateUpload(file: File, bytes?: Uint8Array) {
  if (file.size <= 0 || file.size > env.MAX_UPLOAD_MB * 1024 * 1024) throw new Error(`File must be under ${env.MAX_UPLOAD_MB} MB`);
  const extension = path.extname(file.name).toLowerCase();
  const rule = allowed.get(extension);
  if (!rule || !rule.mime.includes(file.type)) throw new Error("Only PDF, PPT, PPTX, and MP4 files are supported");
  if (bytes && !matchesFileSignature(extension, bytes)) throw new Error("The file contents do not match the selected file type");
  return { type: rule.type, key: `originals/${randomUUID()}${extension}` };
}
