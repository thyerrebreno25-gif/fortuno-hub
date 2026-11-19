import "server-only";
import { prisma } from "@/lib/prisma";
import { canManageOperations, getOperationMember } from "./auth";
import { OperationTimerError } from "./timer-server";
import { distributeDuration, durationLabel, type DurationCorrectionInput } from "./duration-correction";

type Member = NonNullable<Awaited<ReturnType<typeof getOperationMember>>>;
export async function correctActivityDuration(member: Member, activityId: string, input: DurationCorrectionInput) {
  if (member.canEdit === false) throw new OperationTimerError("Sem permissão para corrigir apontamentos.", 403);
  if (input.userId !== member.userId && !canManageOperations(member.role)) throw new OperationTimerError("Você só pode corrigir seu próprio tempo.", 403);
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"operation-timer:" + input.userId}))`;
    await tx.$queryRaw`SELECT id FROM "OperationActivity" WHERE id=${activityId} AND "organizationId"=${member.organizationId} FOR UPDATE`;
    const activity = await tx.operationActivity.findFirst({ where: { id: activityId, organizationId: member.organizationId, deletedAt: null } });
    if (!activity) throw new OperationTimerError("Atividade não encontrada.", 404);
    const entries = await tx.operationTimeEntry.findMany({ where: { activityId, userId: input.userId }, orderBy: [{ startedAt: "asc" }, { id: "asc" }] });
    if (!entries.length && !canManageOperations(member.role) && activity.responsibleId !== member.userId) throw new OperationTimerError("Você só pode apontar tempo nas atividades atribuídas a você.", 403);
    const previousRequest = await tx.operationEvent.findFirst({ where: { activityId, type: "TIME_ADJUSTED", metadata: { path: ["requestId"], equals: input.requestId } }, select: { userId: true, metadata: true } });
    if (previousRequest) {
      const metadata = previousRequest.metadata as { entryUserId?: string; totalSeconds?: number; reason?: string } | null;
      if (previousRequest.userId === member.userId && metadata?.entryUserId === input.userId && metadata.totalSeconds === input.seconds && metadata.reason === input.reason) return { seconds: input.seconds };
      throw new OperationTimerError("Esta correção já foi processada. Atualize a atividade.", 409);
    }
    const expected = new Map(input.expectedEntries.map(entry => [entry.id, new Date(entry.updatedAt).toISOString()]));
    if (expected.size !== input.expectedEntries.length || expected.size !== entries.length || entries.some(entry => expected.get(entry.id) !== entry.updatedAt.toISOString())) throw new OperationTimerError("O tempo mudou enquanto você corrigia. Feche e abra a atividade para conferir o valor atualizado.", 409);
    const person = await tx.organizationMember.findFirst({ where: { organizationId: member.organizationId, userId: input.userId, role: { not: "CLIENT" } }, select: { user: { select: { name: true, email: true } } } });
    if (!person) throw new OperationTimerError("Colaborador não encontrado nesta organização.", 400);
    if (!entries.length && !input.seconds) throw new OperationTimerError("Informe uma duração maior que zero para registrar tempo.", 400);
    const now = new Date();
    const before = entries.map(entry => ({ id: entry.id, startedAt: entry.startedAt.toISOString(), endedAt: entry.endedAt?.toISOString() || null, seconds: entry.seconds, source: entry.source, description: entry.description, elapsedSeconds: entry.endedAt ? entry.seconds : Math.max(0, Math.floor((+now - +entry.startedAt) / 1000)) }));
    const previousSeconds = before.reduce((sum, entry) => sum + entry.elapsedSeconds, 0);
    const allocations = distributeDuration(input.seconds, before.map(entry => entry.elapsedSeconds));
    const after: Array<{ id: string; seconds: number }> = [];
    for (const [index, entry] of entries.entries()) {
      await tx.operationTimeEntry.update({ where: { id: entry.id }, data: { seconds: allocations[index], endedAt: entry.endedAt || now, source: "CORRECTED_DURATION", description: input.reason } });
      after.push({ id: entry.id, seconds: allocations[index] });
    }
    if (!entries.length) {
      // An untimed duration belongs to the activity's date; it does not invent a clock interval.
      const planned = activity.scheduledDate ? new Date(activity.scheduledDate.toISOString().slice(0, 10) + "T12:00:00-03:00") : null;
      const reference = planned && +planned <= +now ? planned : activity.completedAt && +activity.completedAt <= +now ? activity.completedAt : now;
      const entry = await tx.operationTimeEntry.create({ data: { id: input.requestId, activityId, userId: input.userId, startedAt: reference, endedAt: reference, seconds: input.seconds, source: "MANUAL_DURATION", description: input.reason } });
      after.push({ id: entry.id, seconds: input.seconds });
    }
    await tx.operationActivity.updateMany({where:{id:activityId,organizationId:member.organizationId,status:"IN_PROGRESS",timeEntries:{none:{endedAt:null}}},data:{status:"PAUSED"}});
    await tx.operationEvent.create({ data: { activityId, userId: member.userId, type: "TIME_ADJUSTED", message: `${member.user.name || member.user.email} corrigiu a duração de ${person.user.name || person.user.email}: ${durationLabel(previousSeconds)} → ${durationLabel(input.seconds)} (horas:minutos). Justificativa: ${input.reason}`, metadata: { mode: "duration", requestId: input.requestId, entryUserId: input.userId, reason: input.reason, previousSeconds, totalSeconds: input.seconds, before, after } } });
    return { seconds: input.seconds };
  }, { maxWait: 10000, timeout: 15000 });
}
