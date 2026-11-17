import "server-only";
import { prisma } from "@/lib/prisma";
import { canManageOperations, getOperationMember } from "./auth";
import { OperationTimerError } from "./timer-server";
import { correctionInterval, type TimeCorrectionInput } from "./time-correction";

type Member = NonNullable<Awaited<ReturnType<typeof getOperationMember>>>;
const serialize = (entry: { startedAt: Date; endedAt: Date | null; seconds: number; source: string; description: string | null }) => ({ startedAt: entry.startedAt.toISOString(), endedAt: entry.endedAt?.toISOString() || null, seconds: entry.seconds, source: entry.source, description: entry.description });

export async function correctOperationTime(member: Member, activityId: string, input: TimeCorrectionInput) {
  if (member.canEdit === false) throw new OperationTimerError("Sem permissão para corrigir apontamentos.", 403);
  const previous = input.entryId ? await prisma.operationTimeEntry.findFirst({ where: { id: input.entryId, activityId, activity: { organizationId: member.organizationId, deletedAt: null } } }) : null;
  if (input.entryId && !previous) throw new OperationTimerError("Apontamento não encontrado.", 404);
  const userId = previous?.userId || input.userId || member.userId;
  if (userId !== member.userId && !canManageOperations(member.role)) throw new OperationTimerError("Você só pode corrigir seus próprios apontamentos.", 403);

  return prisma.$transaction(async tx => {
    // The same lock order as start/stop and completion prevents lost timer updates.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"operation-timer:" + userId}))`;
    await tx.$queryRaw`SELECT id FROM "OperationActivity" WHERE id=${activityId} AND "organizationId"=${member.organizationId} FOR UPDATE`;
    const activity = await tx.operationActivity.findFirst({ where: { id: activityId, organizationId: member.organizationId, deletedAt: null } });
    if (!activity) throw new OperationTimerError("Atividade não encontrada.", 404);
    const current = input.entryId ? await tx.operationTimeEntry.findFirst({ where: { id: input.entryId, activityId, userId } }) : null;
    if (input.entryId && !current) throw new OperationTimerError("Apontamento não encontrado.", 404);
    if (!current && !canManageOperations(member.role) && activity.responsibleId !== member.userId) throw new OperationTimerError("Você só pode adicionar tempo nas atividades atribuídas a você.", 403);
    if (current && current.updatedAt.toISOString() !== new Date(input.expectedUpdatedAt!).toISOString()) throw new OperationTimerError("O apontamento mudou. Atualize a atividade e confira o tempo antes de corrigir.", 409);
    const person = await tx.organizationMember.findFirst({ where: { organizationId: member.organizationId, userId, role: { not: "CLIENT" } }, select: { userId: true } });
    if (!person) throw new OperationTimerError("Colaborador não encontrado nesta organização.", 400);
    let interval;
    try { interval = correctionInterval(input); }
    catch (error) { throw new OperationTimerError(error instanceof Error ? error.message : "Período inválido.", 400); }
    if (!current && !interval.seconds) throw new OperationTimerError("Informe um período com tempo trabalhado para adicionar um apontamento.", 400);

    // A stable client ID makes a retry of an added period harmless.
    if (!current) {
      const duplicate = await tx.operationTimeEntry.findUnique({ where: { id: input.newEntryId! } });
      if (duplicate) {
        if (duplicate.activityId === activityId && duplicate.userId === userId && duplicate.source === "MANUAL" && +duplicate.startedAt === +interval.startedAt && +duplicate.endedAt! === +interval.endedAt && duplicate.description === input.reason) return duplicate;
        throw new OperationTimerError("Este apontamento já foi salvo. Atualize a atividade.", 409);
      }
    }
    if (interval.seconds > 0) {
      const overlaps = await tx.operationTimeEntry.findMany({ where: { userId, ...(current ? { id: { not: current.id } } : {}), activity: { organizationId: member.organizationId, deletedAt: null }, startedAt: { lt: interval.endedAt }, OR: [{ endedAt: null }, { endedAt: { gt: interval.startedAt } }] }, select: { startedAt: true, endedAt: true } });
      if (overlaps.some(entry => !entry.endedAt || +entry.endedAt > +entry.startedAt)) throw new OperationTimerError("Esse período já possui tempo apontado ou um cronômetro em andamento para o colaborador. Ajuste os horários para evitar contagem duplicada.", 409);
    }
    const entry = current
      ? await tx.operationTimeEntry.update({ where: { id: current.id }, data: { ...interval, source: "CORRECTED", description: input.reason } })
      : await tx.operationTimeEntry.create({ data: { id: input.newEntryId!, activityId, userId, ...interval, source: "MANUAL", description: input.reason } });
    const hours = (seconds: number) => `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}min ${seconds % 60}s`;
    const period = (start: Date, end: Date | null) => `${start.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} até ${end ? end.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "em andamento"}`;
    const beforeSeconds = current ? current.endedAt ? current.seconds : Math.max(0, Math.floor((Date.now() - +current.startedAt) / 1000)) : 0;
    await tx.operationEvent.create({ data: { activityId, userId: member.userId, type: "TIME_ADJUSTED", message: `${member.user.name || member.user.email} ${current ? "corrigiu" : "adicionou"} um apontamento de tempo: ${current ? `${hours(beforeSeconds)} (${period(current.startedAt, current.endedAt)}) → ` : ""}${hours(entry.seconds)} (${period(entry.startedAt, entry.endedAt)}). Justificativa: ${input.reason}`, metadata: { entryId: entry.id, entryUserId: userId, reason: input.reason, before: current ? serialize(current) : null, after: serialize(entry), previousElapsedSeconds: beforeSeconds } } });
    return entry;
  }, { maxWait: 10000, timeout: 15000 });
}
