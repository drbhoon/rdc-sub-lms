import { loadAiHistoryFor } from "@/lib/ai-history";
import { routeCourseManager } from "@/lib/route-auth";

/** One learner's AI questions for the history picker on the admin and teacher course pages. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!await routeCourseManager(id)) return new Response("Forbidden", { status: 403 });
  const employeeId = new URL(request.url).searchParams.get("employeeId") ?? "";
  if (!employeeId) return Response.json({ message: "Choose a learner." }, { status: 400 });
  return Response.json(await loadAiHistoryFor(id, employeeId), { headers: { "Cache-Control": "private, no-store" } });
}
