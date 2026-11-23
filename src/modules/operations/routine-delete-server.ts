import {cancelDisregardNotices} from "./disregard-cancel";
import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { canManageOperations, getOperationMember } from "./auth";
import { OperationTimerError } from "./timer-server";

type Member = NonNullable<Awaited<ReturnType<typeof getOperationMember>>>;
export function requireRoutineDeletion(member: Member) {
  if (!canManageOperations(member.role) || member.canEdit === false) throw new OperationTimerError("Seu perfil não possui permissão para excluir rotinas.", 403);
}
const selection = { disregardReview:true,id: true, status: true, updatedAt: true, timeEntries: { where: { endedAt: null }, select: { id: true, startedAt: true } } } as const;
type Activity = { id: string; status: string; updatedAt: Date; timeEntries: { id: string; startedAt: Date }[] };
function impact(updatedAt: Date, activities: Activity[]) {
  const fingerprint = createHash("sha256").update(JSON.stringify([updatedAt.toISOString(), activities.map(activity => [activity.id, activity.updatedAt.toISOString(), activity.status, activity.timeEntries.map(entry => entry.id).sort()])])).digest("hex");
  return { total: activities.length, completed: activities.filter(activity => activity.status === "COMPLETED").length, running: activities.filter(activity => activity.timeEntries.length > 0).length, fingerprint };
}
export async function previewRoutineDeletion(member: Member, id: string) {
  requireRoutineDeletion(member);
  const configuration = await prisma.operationClientProcess.findFirst({ where: { id, client: { organizationId: member.organizationId } }, select: { id: true, updatedAt: true } });
  if (!configuration) throw new OperationTimerError("Rotina não encontrada.", 404);
  const activities = await prisma.operationActivity.findMany({ where: { clientProcessId: id, organizationId: member.organizationId, deletedAt: null }, select: selection, orderBy: { id: "asc" } });
  return impact(configuration.updatedAt, activities);
}
export async function deleteRoutineSelection(member: Member, id: string, input: { reason: string; confirmation: string; fingerprint: string }) {
  requireRoutineDeletion(member);
  if (input.reason.trim().length < 5 || input.reason.length > 2000) throw new OperationTimerError("Informe uma justificativa de 5 a 2.000 caracteres.", 400);
  if (input.confirmation.trim().toUpperCase() !== "EXCLUIR ROTINA" || !/^[a-f0-9]{64}$/.test(input.fingerprint)) throw new OperationTimerError("Confira a rotina e digite EXCLUIR ROTINA para confirmar.", 400);
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"operations-reset-" + member.organizationId}))`;
    await tx.$queryRaw`SELECT cp.id FROM "OperationClientProcess" cp JOIN "Client" c ON c.id=cp."clientId" WHERE cp.id=${id} AND c."organizationId"=${member.organizationId} FOR UPDATE OF cp`;
    const configuration = await tx.operationClientProcess.findFirst({ where: { id, client: { organizationId: member.organizationId } }, include: { client: { select: { name: true } }, process: { select: { name: true } } } });
    if (!configuration) throw new OperationTimerError("Rotina não encontrada.", 404);
    await tx.$queryRaw`SELECT id FROM "OperationActivity" WHERE "clientProcessId"=${id} AND "organizationId"=${member.organizationId} AND "deletedAt" IS NULL ORDER BY id FOR UPDATE`;
    const activities = await tx.operationActivity.findMany({ where: { clientProcessId: id, organizationId: member.organizationId, deletedAt: null }, select: selection, orderBy: { id: "asc" } });
    if (impact(configuration.updatedAt, activities).fingerprint !== input.fingerprint) throw new OperationTimerError("A rotina ou suas atividades mudaram. Confira novamente antes de excluir.", 409);
    const now = new Date(), ids = activities.map(activity => activity.id);
    for (const activity of activities) for (const timer of activity.timeEntries) await tx.operationTimeEntry.update({ where: { id: timer.id }, data: { endedAt: now, seconds: Math.max(0, Math.floor((+now - +timer.startedAt) / 1000)) } });
    if (ids.length) {
      await tx.operationEvent.createMany({ data: ids.map(activityId => ({ activityId, userId: member.userId, type: "ACTIVITY_DELETED" as const, message: `${member.user.name || member.user.email} excluiu a atividade ao remover esta rotina.`, metadata: { reason: input.reason.trim(), routineId: id, routineClient: configuration.client.name, routineProcess: configuration.process.name } })) });
      await tx.operationActivity.updateMany({ where: { id: { in: ids }, organizationId: member.organizationId, clientProcessId: id, deletedAt: null }, data: { deletedAt: now, deletedById: member.userId, deletionReason: `Rotina excluída: ${input.reason.trim()}` } });
    }
    await cancelDisregardNotices(tx,member.organizationId,activities,now);
    // SetNull preserves records and files for audit; the selected configuration alone is removed.
    await tx.operationClientProcess.delete({ where: { id } });
    return { message: "Rotina excluída com sucesso.", removedActivities: ids.length };
  }, { maxWait: 10000, timeout: 30000 });
}
