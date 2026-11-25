import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { canManageOperations, getOperationMember } from "@/modules/operations/auth";
import { routineScheduleKey } from "@/modules/operations/routine-schedule";
import {resetPreservation} from "@/modules/operations/reset-preservation";
export const maxDuration = 120;
const activityLimit = 20000;
const batchSize = 500;
const pending = (organizationId: string): Prisma.OperationActivityWhereInput => ({ organizationId, deletedAt: null, status: { in: ["OPEN", "IN_PROGRESS", "PAUSED", "BLOCKED"] } });
const saved = z.object({ configurations: z.array(z.string()), activities: z.array(z.object({ id: z.string(), clientProcessId: z.string().nullable() })) });
async function manager() { const member = await getOperationMember(); return member && canManageOperations(member.role) && member.canEdit!==false ? member : null; }
export async function GET() {
  const member = await manager();
  if (!member) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  const preservation=resetPreservation(member.organizationId);
  const [activities, allActivities, configurations, last,protectedActivities,removableActivities,futureActivities] = await Promise.all([
    prisma.operationActivity.count({ where: pending(member.organizationId) }),
    prisma.operationActivity.count({ where: { organizationId: member.organizationId, deletedAt: null } }),
    prisma.operationClientProcess.count({ where: { active: true, client: { organizationId: member.organizationId } } }),
    prisma.auditLog.findFirst({ where: { entity: "OperationsReset", entityId: member.organizationId, action: "OPERATIONS_RESET" }, orderBy: { createdAt: "desc" }, select: { id: true } }),
    prisma.operationActivity.count({where:preservation.protectedWhere}),
    prisma.operationActivity.count({where:preservation.removableWhere}),
    prisma.operationActivity.count({where:preservation.futureWhere}),
  ]);
  const restored = last ? await prisma.auditLog.findFirst({ where: { entity: "OperationsReset", entityId: last.id, action: "OPERATIONS_RESET_RESTORED" }, select: { id: true } }) : null;
  return NextResponse.json({ activities, allActivities, configurations,protectedActivities,removableActivities,futureActivities,preserveDay:preservation.day, restoreId: last && !restored ? last.id : null },{headers:{"Cache-Control":"private, no-store"}});
}
export async function POST(request: Request) {
  const member = await manager();
  if (!member) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  const input = z.object({ action: z.enum(["archive", "restore"]), scope:z.enum(["pending","all","except_today","future_only"]).default("pending"), preserveDay:z.string().optional(),restoreId: z.string().max(100).nullish() }).strict().safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"operations-reset-" + member.organizationId}))`;
      if (input.data.action === "restore") {
        const audit = await tx.auditLog.findFirst({ where: { id: input.data.restoreId || "", entity: "OperationsReset", entityId: member.organizationId, action: "OPERATIONS_RESET" } });
        const snapshot = saved.safeParse(audit?.beforeData);
        if (!audit || !snapshot.success) throw new Error("CONFLICT");
        if (await tx.auditLog.findFirst({ where: { entity: "OperationsReset", entityId: audit.id, action: "OPERATIONS_RESET_RESTORED" } })) throw new Error("CONFLICT");
        const configurations = await tx.operationClientProcess.findMany({ where: { id: { in: snapshot.data.configurations }, client: { organizationId: member.organizationId } }, select: { id: true, active: true, clientId:true, processId:true, recurrenceType:true, recurrenceData:true } });
        if (configurations.length !== snapshot.data.configurations.length || configurations.some((c) => c.active)) throw new Error("CONFLICT");
        const active = configurations.length ? await tx.operationClientProcess.findMany({where:{active:true,client:{organizationId:member.organizationId},OR:configurations.map(c=>({clientId:c.clientId,processId:c.processId}))},select:{clientId:true,processId:true,recurrenceType:true,recurrenceData:true}}) : [];
        const key=(c:typeof active[number])=>JSON.stringify([c.clientId,c.processId,routineScheduleKey(c.recurrenceType,c.recurrenceData)]);
        const activeKeys=new Set(active.map(key));
        if(configurations.some(c=>activeKeys.has(key(c))))throw new Error("CONFLICT");
        const groups=new Map<string|null,string[]>();
        for(const activity of snapshot.data.activities){const ids=groups.get(activity.clientProcessId)||[];ids.push(activity.id);groups.set(activity.clientProcessId,ids);}
        for (const [clientProcessId,ids] of groups) {
          for(let offset=0;offset<ids.length;offset+=batchSize){
            const batch=ids.slice(offset,offset+batchSize);
            const updated = await tx.operationActivity.updateMany({ where: { id:{in:batch}, organizationId: member.organizationId, deletionReason: `Limpeza de rotinas: ${audit.id}` }, data: { deletedAt: null, deletedById: null, deletionReason: null, clientProcessId } });
            if (updated.count!==batch.length) throw new Error("CONFLICT");
          }
        }
        await tx.operationClientProcess.updateMany({ where: { id: { in: snapshot.data.configurations }, client: { organizationId: member.organizationId } }, data: { active: true } });
        await tx.auditLog.create({ data: { userId: member.userId, entity: "OperationsReset", entityId: audit.id, action: "OPERATIONS_RESET_RESTORED", afterData: { organizationId: member.organizationId } } });
        return { activities: snapshot.data.activities.length, configurations: configurations.length, restored: true };
      }
      const now = new Date(), id = randomUUID();
      const preservation=resetPreservation(member.organizationId,now),futureOnly=input.data.scope==="future_only",preserving=input.data.scope==="except_today"||futureOnly;
      if(preserving&&input.data.preserveDay!==preservation.day)throw new Error("DAY_CHANGED");
      // Timer starts lock the same activity rows. A running task cannot slip into the removal set.
      if(preserving)await tx.$queryRaw`SELECT id FROM "OperationActivity" WHERE "organizationId"=${member.organizationId} AND "deletedAt" IS NULL ORDER BY id FOR UPDATE`;
      const scope:Prisma.OperationActivityWhereInput=futureOnly?preservation.futureWhere:preserving?preservation.removableWhere:input.data.scope==="all"?{organizationId:member.organizationId,deletedAt:null}:pending(member.organizationId);
      const [activities, configurations] = await Promise.all([
        tx.operationActivity.findMany({ where: scope, select: { id: true, clientProcessId: true }, take: activityLimit+1 }),
        tx.operationClientProcess.findMany({ where: { active: true, client: { organizationId: member.organizationId } }, select: { id: true }, take: 10001 }),
      ]);
      if (activities.length > activityLimit || configurations.length > 10000) throw new Error("LIMIT");
      const protectedActivities=preserving?await tx.operationActivity.count({where:preservation.protectedWhere}):undefined;
      if (!activities.length && !configurations.length) return { activities: 0, configurations: 0,...(preserving?{preserveDay:preservation.day,protectedActivities}: {}) };
      const ids = activities.map((activity) => activity.id);
      const timers = await tx.operationTimeEntry.findMany({ where: { activityId: { in: ids }, endedAt: null }, select: { id: true, startedAt: true } });
      for (const timer of timers) await tx.operationTimeEntry.update({ where: { id: timer.id }, data: { endedAt: now, seconds: Math.max(0, Math.floor((+now - +timer.startedAt) / 1000)) } });
      for(let offset=0;offset<ids.length;offset+=batchSize)await tx.operationActivity.updateMany({ where: { ...scope, id: { in: ids.slice(offset,offset+batchSize) } }, data: { deletedAt: now, deletedById: member.userId, deletionReason: `Limpeza de rotinas: ${id}` } });
      await tx.operationClientProcess.updateMany({ where: { id: { in: configurations.map((c) => c.id) }, client: { organizationId: member.organizationId } }, data: { active: false } });
      await tx.auditLog.create({ data: { id, userId: member.userId, entity: "OperationsReset", entityId: member.organizationId, action: "OPERATIONS_RESET", beforeData: { configurations: configurations.map((c) => c.id), activities }, afterData: { activities: activities.length, configurations: configurations.length, scope:input.data.scope,...(preserving?{preserveDay:preservation.day,protectedActivities}: {}) } } });
      return { activities: activities.length, configurations: configurations.length,...(preserving?{preserveDay:preservation.day,protectedActivities}: {}) };
    }, { timeout: 60000 });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error && error.message === "DAY_CHANGED"?"O dia mudou desde a prévia. Confira novamente antes de limpar.":error instanceof Error && error.message === "LIMIT" ? "Há registros demais para uma única limpeza." : "Não foi possível concluir. Os dados foram preservados; a restauração pode conflitar com novas rotinas." }, { status: 409 });
  }
}
