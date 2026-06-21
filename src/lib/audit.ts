import { db } from "@/lib/db";

export async function audit(actorUserId: string | null, action: string, entityType: string, entityId?: string, metadata?: object) {
  await db.auditLog.create({ data: { actorUserId, action, entityType, entityId, metadata } });
}
