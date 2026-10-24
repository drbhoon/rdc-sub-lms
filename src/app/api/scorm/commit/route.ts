import { NextRequest } from "next/server";
import { currentUser } from "@/lib/session";
import { recordScormCommit } from "@/lib/scorm-attempts";
import { commitSchema } from "@/lib/scorm-runtime";
import { z } from "zod";

const body = z.object({ attemptId: z.string().min(1).max(60), commit: commitSchema });

/** The package's progress, sent from the player on every save and when the learner leaves (a beacon, so no reply is read). */
export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!user?.employeeId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request" }, { status: 400 });
  const result = await recordScormCommit(parsed.data.attemptId, user.employeeId, parsed.data.commit);
  if (!result) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(result);
}
