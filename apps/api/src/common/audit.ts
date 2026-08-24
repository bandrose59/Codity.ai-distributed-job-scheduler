import { prisma } from "@job-scheduler/database";
import type { Prisma } from "@prisma/client";

export async function recordAudit(
  actorId: string,
  action: string,
  targetType: string,
  targetId: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorId,
      action,
      targetType,
      targetId,
      ...(metadata ? { metadata: metadata as Prisma.InputJsonValue } : {})
    }
  });
}