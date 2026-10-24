import { NextRequest } from "next/server";
import { UserRole } from "@prisma/client";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { byteRange } from "@/lib/byte-range";
import { scormMime } from "@/lib/scorm-mime";
import { storage } from "@/lib/storage";

/**
 * The files of an unpacked SCORM package, served from the LMS's own address
 * (a package's scripts must run on the same origin as the page that gives them
 * their API). Same access rule as every other lesson file: course managers
 * always, learners only when enrolled in the published course.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ contentId: string; path: string[] }> }) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { contentId, path: parts } = await context.params;
  const relative = parts.map((part) => decodeURIComponent(part)).join("/");
  if (!relative || relative.includes("\0") || relative.split("/").some((part) => part === ".." || part === "")) return new Response("Not found", { status: 404 });

  const content = await db.courseContent.findUnique({ where: { id: contentId }, include: { course: true } });
  if (!content || content.type !== "SCORM") return new Response("Not found", { status: 404 });
  const elevated = user.roles.some((r) => r.role === UserRole.SUPER_ADMIN)
    || Boolean(await db.courseTeacher.findUnique({ where: { courseId_userId: { courseId: content.courseId, userId: user.id } } }));
  if (!elevated) {
    const enrolled = user.employeeId
      ? Boolean(await db.enrollment.findUnique({ where: { employeeId_courseId: { employeeId: user.employeeId, courseId: content.courseId } } }))
      : false;
    if (!enrolled || !content.isPublished || content.course.status !== "PUBLISHED") return new Response("Forbidden", { status: 403 });
  }

  const key = `scorm/${contentId}/${relative}`;
  const size = await storage.size(key);
  if (size === null) return new Response("Not found", { status: 404 });
  const headers = { "Content-Type": scormMime(relative), "Cache-Control": "private, max-age=600", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes" };
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
