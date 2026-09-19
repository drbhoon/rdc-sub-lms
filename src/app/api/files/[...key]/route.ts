import { NextRequest } from "next/server";
import { UserRole } from "@prisma/client";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { byteRange } from "@/lib/byte-range";
import { storage } from "@/lib/storage";

export async function GET(request: NextRequest, context: { params: Promise<{ key: string[] }> }) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { key: parts } = await context.params;
  const key = parts.join("/");
  const generatedContentId = /^generated\/([^/]+)\//.exec(key)?.[1];
  const content = generatedContentId
    ? await db.courseContent.findUnique({ where: { id: generatedContentId }, include: { course: true } })
    : await db.courseContent.findFirst({ where: { storedKey: key }, include: { course: true } });
  if (!content) return new Response("Not found", { status: 404 });
  const elevated = user.roles.some((r) => r.role === UserRole.SUPER_ADMIN) || Boolean(await db.courseTeacher.findUnique({ where: { courseId_userId: { courseId: content.courseId, userId: user.id } } }));
  const enrolled = user.employeeId ? Boolean(await db.enrollment.findUnique({ where: { employeeId_courseId: { employeeId: user.employeeId, courseId: content.courseId } } })) : false;
  if (!elevated && (!enrolled || !content.isPublished || content.course.status !== "PUBLISHED")) return new Response("Forbidden", { status: 403 });
  const type = key.endsWith(".png") ? "image/png" : content.mimeType;
  const headers = { "Content-Type": type, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes" };
  const size = await storage.size(key);
  if (size === null) return new Response("Not found", { status: 404 });

  // Byte ranges, so a video can be scrubbed and starts playing without
  // downloading the whole file first — and Safari will not play an MP4 at
  // all from a server that ignores Range. Streamed, never read into memory.
  const range = byteRange(request.headers.get("range"), size);
  if (range === "invalid") return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
  if (range) {
    return new Response(storage.stream(key, range), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${range.start}-${range.end}/${size}`, "Content-Length": String(range.end - range.start + 1) },
    });
  }
  return new Response(storage.stream(key), { headers: { ...headers, "Content-Length": String(size) } });
}
