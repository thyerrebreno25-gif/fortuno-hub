import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { canManageOperations, getOperationMember } from "@/modules/operations/auth";
export const maxDuration = 120;
const pending = (organizationId: string): Prisma.OperationActivityWhereInput => ({ organizationId, deletedAt: null, status: { in: ["OPEN", "IN_PROGRESS", "BLOCKED"] } });
const saved = z.object({ configurations: z.array(z.string()), activities: z.array(z.object({ id: z.string(), clientProcessId: z.string().nullable() })) });
async function manager() { const member = await getOperationMember(); return member && canManageOperations(member.role) ? member : null; }
export async function GET() {
  const member = await manager();
  if (!member) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  const [activities, configurations, last] = await Promise.all([
    prisma.operationActivity.count({ where: pending(member.organizationId) }),
    prisma.operationClientProcess.count({ where: { active: true, client: { organizationId: member.organizationId } } }),
    prisma.auditLog.findFirst({ where: { entity: "OperationsReset", entityId: member.organizationId, action: "OPERATIONS_RESET" }, orderBy: { createdAt: "desc" }, select: { id: true } }),
  ]);
  const restored = last ? await prisma.auditLog.findFirst({ where: { entity: "OperationsReset", entityId: last.id, action: "OPERATIONS_RESET_RESTORED" }, select: { id: true } }) : null;
  return NextResponse.json({ activities, configurations, restoreId: last && !restored ? last.id : null });
}
export async function POST(request: Request) {
  const member = await manager();
  if (!member) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  const input = z.object({ action: z.enum(["archive", "restore"]), restoreId: z.string().max(100).nullish() }).safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"operations-reset-" + member.organizationId}))`;
      if (input.data.action === "restore") {
        const audit = await tx.auditLog.findFirst({ where: { id: input.data.restoreId || "", entity: "OperationsReset", entityId: member.organizationId, action: "OPERATIONS_RESET" } });
        const snapshot = saved.safeParse(audit?.beforeData);
        if (!audit || !snapshot.success) throw new Error("CONFLICT");
        if (await tx.auditLog.findFirst({ where: { entity: "OperationsReset", entityId: audit.id, action: "OPERATIONS_RESET_RESTORED" } })) throw new Error("CONFLICT");
        const configurations = await tx.operationClientProcess.findMany({ where: { id: { in: snapshot.data.configurations }, client: { organizationId: member.organizationId } }, select: { id: true, active: true } });
        if (configurations.length !== snapshot.data.configurations.length || configurations.some((c) => c.active)) throw new Error("CONFLICT");
        for (const activity of snapshot.data.activities) {
          const updated = await tx.operationActivity.updateMany({ where: { id: activity.id, organizationId: member.organizationId, deletionReason: `Limpeza de rotinas: ${audit.id}` }, data: { deletedAt: null, deletedById: null, deletionReason: null, clientProcessId: activity.clientProcessId } });
          if (!updated.count) throw new Error("CONFLICT");
        }
        await tx.operationClientProcess.updateMany({ where: { id: { in: snapshot.data.configurations }, client: { organizationId: member.organizationId } }, data: { active: true } });
        await tx.auditLog.create({ data: { userId: member.userId, entity: "OperationsReset", entityId: audit.id, action: "OPERATIONS_RESET_RESTORED", afterData: { organizationId: member.organizationId } } });
        return { activities: snapshot.data.activities.length, configurations: configurations.length, restored: true };
      }
      const now = new Date(), id = randomUUID();
      const [activities, configurations] = await Promise.all([
        tx.operationActivity.findMany({ where: pending(member.organizationId), select: { id: true, clientProcessId: true }, take: 10001 }),
        tx.operationClientProcess.findMany({ where: { active: true, client: { organizationId: member.organizationId } }, select: { id: true }, take: 10001 }),
      ]);
      if (activities.length > 10000 || configurations.length > 10000) throw new Error("LIMIT");
      if (!activities.length && !configurations.length) return { activities: 0, configurations: 0 };
      const ids = activities.map((activity) => activity.id);
      const timers = await tx.operationTimeEntry.findMany({ where: { activityId: { in: ids }, endedAt: null }, select: { id: true, startedAt: true } });
      for (const timer of timers) await tx.operationTimeEntry.update({ where: { id: timer.id }, data: { endedAt: now, seconds: Math.max(0, Math.floor((+now - +timer.startedAt) / 1000)) } });
      await tx.operationActivity.updateMany({ where: { ...pending(member.organizationId), id: { in: ids } }, data: { deletedAt: now, deletedById: member.userId, deletionReason: `Limpeza de rotinas: ${id}` } });
      await tx.operationClientProcess.updateMany({ where: { id: { in: configurations.map((c) => c.id) }, client: { organizationId: member.organizationId } }, data: { active: false } });
      await tx.auditLog.create({ data: { id, userId: member.userId, entity: "OperationsReset", entityId: member.organizationId, action: "OPERATIONS_RESET", beforeData: { configurations: configurations.map((c) => c.id), activities }, afterData: { activities: activities.length, configurations: configurations.length } } });
      return { activities: activities.length, configurations: configurations.length };
    }, { timeout: 60000 });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error && error.message === "LIMIT" ? "Há registros demais para uma única limpeza." : "Não foi possível concluir. Os dados foram preservados; a restauração pode conflitar com novas rotinas." }, { status: 409 });
  }
}
