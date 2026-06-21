import { redirect } from "next/navigation";
import { requireUser, hasRole } from "@/lib/session";
export default async function Dashboard() {
  const user = await requireUser();
  if (hasRole(user, "SUPER_ADMIN")) redirect("/admin");
  if (hasRole(user, "TEACHER")) redirect("/teacher/courses");
  redirect("/learn/courses");
}
