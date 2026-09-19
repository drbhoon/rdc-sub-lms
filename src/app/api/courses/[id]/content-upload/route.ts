import { UserRole } from "@prisma/client";
import { recordCourseContent } from "@/lib/course-content";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { routeUserWithRole } from "@/lib/route-auth";
import { storage } from "@/lib/storage";
import { UPLOAD_CHUNK_BYTES, incomingKey, isUploadId } from "@/lib/upload-chunks";
import { validateUpload } from "@/lib/uploads";

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

function json(body: object, status = 200) {
  return Response.json(body, { status });
}

/** Uploads abandoned part-way would otherwise sit on disk for ever. */
async function sweepStaleUploads() {
  const cutoff = Date.now() - STALE_AFTER_MS;
  for (const item of await storage.list("incoming")) {
    if (item.modifiedAt.getTime() < cutoff) await storage.delete(item.key);
  }
}

/**
 * Chunked course-content upload — see lib/upload-chunks.ts for why.
 *
 *   POST ?uploadId=<uuid>&offset=<n>   body: the next piece, raw bytes
 *   POST ?uploadId=<uuid>&complete=1   body: { fileName, fileType, fileSize }
 *
 * Pieces must arrive in order: the offset has to equal what is already
 * stored, and a mismatch answers 409 with the stored size so the browser can
 * resume from there after a dropped connection instead of corrupting the file.
 * Nothing becomes course content until "complete", which checks the size,
 * type and file signature exactly as a single upload always did.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await routeUserWithRole(UserRole.SUPER_ADMIN);
  if (!actor) return json({ message: "Only an admin can upload course content." }, 403);
  const { id: courseId } = await context.params;
  const params = new URL(request.url).searchParams;
  const uploadId = params.get("uploadId") ?? "";
  if (!isUploadId(uploadId)) return json({ message: "Invalid upload id." }, 400);
  const key = incomingKey(uploadId);
  const maxBytes = env.MAX_UPLOAD_MB * 1024 * 1024;

  if (params.get("complete") === "1") {
    const course = await db.course.findUnique({ where: { id: courseId } });
    if (!course || course.status === "ARCHIVED") return json({ message: "Course is unavailable." }, 404);
    const body = await request.json().catch(() => null) as { fileName?: unknown; fileType?: unknown; fileSize?: unknown } | null;
    const description = { name: String(body?.fileName ?? ""), type: String(body?.fileType ?? ""), size: Number(body?.fileSize ?? 0) };
    const stored = await storage.size(key);
    if (stored === null) return json({ message: "Nothing was received for this upload. Please upload the file again." }, 400);
    if (stored !== description.size) {
      return json({ message: `Only ${stored} of ${description.size} bytes arrived. Please upload the file again.` }, 400);
    }
    try {
      // The first bytes carry the file signature; no need to read a whole video for them.
      const head = new Uint8Array(await new Response(storage.stream(key, { start: 0, end: 15 })).arrayBuffer());
      const validated = validateUpload(description, head);
      await storage.move(key, validated.key);
      await recordCourseContent({
        actorId: actor.id, courseId, fileName: description.name, mimeType: description.type,
        sizeBytes: description.size, storedKey: validated.key, type: validated.type,
      });
      return json({ message: "Upload queued for processing." });
    } catch (error) {
      await storage.delete(key);
      return json({ message: error instanceof Error ? error.message : "Upload failed." }, 400);
    }
  }

  const offset = Number(params.get("offset"));
  if (!Number.isInteger(offset) || offset < 0) return json({ message: "Invalid offset." }, 400);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length || bytes.length > UPLOAD_CHUNK_BYTES) return json({ message: "Invalid piece size." }, 400);
  if (offset === 0) await sweepStaleUploads();
  const stored = (await storage.size(key)) ?? 0;
  if (offset !== stored) return json({ message: "Out of order.", received: stored }, 409);
  if (stored + bytes.length > maxBytes) {
    await storage.delete(key);
    return json({ message: `File must be under ${env.MAX_UPLOAD_MB} MB` }, 413);
  }
  await storage.append(key, bytes);
  return json({ received: stored + bytes.length });
}
