import { NextRequest } from "next/server";
import { UserRole } from "@prisma/client";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { storage } from "@/lib/storage";

export async function GET(_: NextRequest, context: { params: Promise<{ key: string[] }> }) {
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
  try {
    const bytes = await storage.get(key);
    const type = key.endsWith(".png") ? "image/png" : content.mimeType;
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
  } catch { return new Response("Not found", { status: 404 }); }
}
