import "server-only";
import type {Prisma} from "@/generated/prisma/client";
import type {getOperationMember} from "./auth";
import {OperationTimerError} from "./timer-server";
type Member=NonNullable<Awaited<ReturnType<typeof getOperationMember>>>;
// Caller holds the organization edit lock and all activity rows for this routine.
// Ownership changes are independent of date, status or evidence of execution.
export async function reassignRoutine(tx: Prisma.TransactionClient, member: Member, routineId: string, responsibleId: string | null) {
  const scope = { organizationId: member.organizationId, clientProcessId: routineId, deletedAt: null };
  const activities = await tx.operationActivity.findMany({ where: scope, select: { id: true, responsibleId: true } });
  const changed = activities.filter(activity => activity.responsibleId !== responsibleId);
  if (!changed.length) return { transferred: 0, pausedTimers: 0 };
  const ids = changed.map(activity => activity.id), now = new Date();
  const timers = await tx.operationTimeEntry.findMany({ where: { activityId: { in: ids }, activity: scope, endedAt: null }, select: { id: true, activityId: true, startedAt: true } });
  let pausedTimers = 0;
  for (const timer of timers) {
    const result = await tx.operationTimeEntry.updateMany({ where: { id: timer.id, activityId: timer.activityId, endedAt: null }, data: { endedAt: now, seconds: Math.max(0, Math.floor((+now - +timer.startedAt) / 1000)) } });
    pausedTimers += result.count;
  }
  const result = await tx.operationActivity.updateMany({ where: { ...scope, id: { in: ids } }, data: { responsibleId } });
  if (result.count !== ids.length) throw new OperationTimerError("As tarefas mudaram durante a transferência. Atualize a rotina e tente novamente.", 409);
  await tx.operationActivity.updateMany({ where: { ...scope, id: { in: ids }, status: "IN_PROGRESS", timeEntries: { none: { endedAt: null } } }, data: { status: "PAUSED" } });
  for (let index = 0; index < changed.length; index += 500) {
    await tx.operationEvent.createMany({ data: changed.slice(index, index + 500).map(activity => ({ activityId: activity.id, userId: member.userId, type: "ASSIGNED" as const, message: "Responsável atualizado pela edição da rotina configurada.", metadata: { routineId, fromResponsibleId: activity.responsibleId, toResponsibleId: responsibleId, action: "EDIT_ROUTINE_RESPONSIBLE" } })) });
  }
  return { transferred: changed.length, pausedTimers };
}
