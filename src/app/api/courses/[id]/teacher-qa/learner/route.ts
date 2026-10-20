import { routeCourseManager } from "@/lib/route-auth";
import { loadTeacherQaFor } from "@/lib/teacher-qa";

/** One learner's questions to their teacher, for the Q&A history picker on the course pages. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const viewer = await routeCourseManager(id);
  if (!viewer) return new Response("Forbidden", { status: 403 });
  const employeeId = new URL(request.url).searchParams.get("employeeId") ?? "";
  if (!employeeId) return Response.json({ message: "Choose a learner." }, { status: 400 });
  return Response.json(await loadTeacherQaFor(id, employeeId, viewer), { headers: { "Cache-Control": "private, no-store" } });
}
