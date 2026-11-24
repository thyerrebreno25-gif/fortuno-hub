import "server-only";
import { prisma } from "@/lib/prisma";
import { type Prisma } from "@/generated/prisma/client";
import { requireRoutineDeletion } from "./routine-delete-server";
import { type getOperationMember } from "./auth";
import { OperationTimerError } from "./timer-server";
import { operationToday } from "./activity-deadline";
import { operationTeamCatalog } from "./team-catalog";
import { canonicalTeam } from "./teams";
import { responsibleForProcess } from "./responsible";
import { routineScheduleKey } from "./routine-schedule";
import { routineDates, ROUTINE_EDIT_REMOVAL, untouchedRoutineActivity } from "./routine-edit-plan";
import type { RoutineEdit } from "./edit-model";
type Member = NonNullable<Awaited<ReturnType<typeof getOperationMember>>>;

// Caller holds the organization edit lock and all activity rows for this routine.
// Ownership changes are independent of date, status or evidence of execution.
async function reassignRoutine(tx: Prisma.TransactionClient, member: Member, routineId: string, responsibleId: string | null) {
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

export async function editRoutine(member: Member, id: string, input: RoutineEdit) {
  requireRoutineDeletion(member);
  const team = canonicalTeam(input.team);
  if (team && !(await operationTeamCatalog(member.organizationId)).options.includes(team)) throw new OperationTimerError("Selecione uma equipe da lista.", 400);
  if (input.responsibleId && !await prisma.organizationMember.findFirst({ where: { organizationId: member.organizationId, userId: input.responsibleId, role: { not: "CLIENT" } }, select: { id: true } })) throw new OperationTimerError("Colaborador não encontrado nesta organização.", 400);
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"operations-reset-" + member.organizationId}))`;
    await tx.$queryRaw`SELECT cp.id FROM "OperationClientProcess" cp JOIN "Client" c ON c.id=cp."clientId" WHERE cp.id=${id} AND c."organizationId"=${member.organizationId} FOR UPDATE OF cp`;
    const configuration = await tx.operationClientProcess.findFirst({ where: { id, active: true, client: { organizationId: member.organizationId } }, include: { client: true, process: { include: { checklistTemplates: { orderBy: { position: "asc" } } } } } });
    if (!configuration) throw new OperationTimerError("Rotina não encontrada.", 404);
    if (configuration.updatedAt.toISOString() !== input.expectedUpdatedAt) throw new OperationTimerError("A rotina mudou. Reabra a edição para conferir os dados atuais.", 409);
    const responsibleChanged = (configuration.responsibleId ?? null) !== input.responsibleId;
    const responsibleId = input.responsibleId || responsibleForProcess(configuration.client, configuration.process);
    if (responsibleChanged && responsibleId) {
      await tx.$queryRaw`SELECT "userId" FROM "OrganizationMember" WHERE "organizationId"=${member.organizationId} AND "userId"=${responsibleId} FOR SHARE`;
      if (!await tx.organizationMember.findFirst({where:{organizationId:member.organizationId,userId:responsibleId,role:{not:"CLIENT"}},select:{userId:true}})) throw new OperationTimerError("O novo responsável não pertence mais à organização. Atualize a rotina.",409);
    }
    const others = await tx.operationClientProcess.findMany({ where: { id: { not: id }, clientId: configuration.clientId, processId: configuration.processId, active: true } });
    if (others.some(other => routineScheduleKey(other.recurrenceType, other.recurrenceData) === routineScheduleKey(input.recurrenceType, input.recurrenceData))) throw new OperationTimerError("Já existe outra rotina com esta programação. Confira as possíveis duplicadas.", 409);
    const today = operationToday(), start = new Date(today + "T00:00:00Z");
    if (responsibleChanged) await tx.$queryRaw`SELECT id FROM "OperationActivity" WHERE "clientProcessId"=${id} AND "organizationId"=${member.organizationId} ORDER BY id FOR UPDATE`;
    else await tx.$queryRaw`SELECT id FROM "OperationActivity" WHERE "clientProcessId"=${id} AND "organizationId"=${member.organizationId} AND "scheduledDate">=${start} ORDER BY id FOR UPDATE`;
    const activities = await tx.operationActivity.findMany({ where: { clientProcessId: id, organizationId: member.organizationId, scheduledDate: { gte: start } }, include: { timeEntries: { select: { id: true } }, comments: { select: { id: true } }, attachments: { select: { id: true } }, checklistItems: { select: { completed: true, disregardedAt: true, comment: true } } }, orderBy: { scheduledDate: "asc" }, take: 10001 });
    if (activities.length > 10000) throw new OperationTimerError("Esta rotina possui muitas atividades futuras. Divida a programação em períodos menores.", 422);
    const horizon = new Date(Math.max(+new Date((input.recurrenceData.startDate>today?input.recurrenceData.startDate:today)+"T00:00:00Z") + 89 * 86400000, ...activities.map(activity => +(activity.scheduledDate || start))));
    if (+horizon - +start > 730 * 86400000) throw new OperationTimerError("O horizonte desta rotina excede dois anos. Reduza a programação antes de editar.", 422);
    const holidays = await tx.operationHoliday.findMany({ where: { organizationId: member.organizationId, date: { gte: new Date(+start - 10 * 86400000), lte: new Date(+horizon + 10 * 86400000) } }, select: { date: true } });
    const dates = routineDates(input, today, horizon.toISOString().slice(0, 10), new Set(holidays.map(holiday => holiday.date.toISOString().slice(0, 10))));
    await tx.operationClientProcess.update({ where: { id }, data: { responsibleId: input.responsibleId, team, priority: input.priority, notifyClient: input.notifyClient, auditEnabled: input.auditEnabled, recurrenceType: input.recurrenceType, recurrenceData: input.recurrenceData } });
    let updated = 0, removed = 0, created = 0, preserved = 0;
    const existing = new Map(activities.map(activity => [activity.scheduledDate!.toISOString().slice(0, 10), activity]));
    for (const activity of activities) {
      const day = activity.scheduledDate!.toISOString().slice(0, 10), dueAt = dates.get(day);
      if (!untouchedRoutineActivity(activity) || activity.deletedAt && activity.deletionReason !== ROUTINE_EDIT_REMOVAL) { preserved++; continue; }
      if (dueAt) {
        await tx.operationActivity.update({ where: { id: activity.id }, data: { ...(!responsibleChanged ? { responsibleId } : {}), team, priority: input.priority, dueAt, deletedAt: null, deletedById: null, deletionReason: null } }); updated++;
        await tx.operationEvent.create({ data: { activityId: activity.id, userId: member.userId, type: "STATUS_CHANGED", message: "Programação atualizada pela edição da rotina.", metadata: { routineId: id, action: "EDIT_ROUTINE" } } });
      } else if (!activity.deletedAt) {
        await tx.operationActivity.update({ where: { id: activity.id }, data: { deletedAt: new Date(), deletedById: member.userId, deletionReason: ROUTINE_EDIT_REMOVAL } }); removed++;
        await tx.operationEvent.create({ data: { activityId: activity.id, userId: member.userId, type: "ACTIVITY_DELETED", message: "Atividade sem execução removida pela alteração dos dias da rotina.", metadata: { routineId: id } } });
      }
    }
    for (const [day, dueAt] of dates) {
      if (existing.has(day)) continue;
      const scheduledDate = new Date(day + "T00:00:00Z"), process = configuration.process;
      const data: Prisma.OperationActivityUncheckedCreateInput = { organizationId: member.organizationId, clientId: configuration.clientId, processId: configuration.processId, clientProcessId: id, responsibleId, team, scheduledDate, title: process.name, department: process.department, description: process.description, dueAt, legalDate: scheduledDate, competence: day.slice(0, 7), subjectToFine: process.subjectToFine, priority: input.priority, clientCluster: configuration.client.cluster, checklistItems: { create: process.checklistTemplates.map(item => ({ templateId: item.id, title: item.title, description: item.description, mandatory: item.mandatory, requiresComment: item.requiresComment, requiresAttachment: item.requiresAttachment, allowedFileTypes: item.allowedFileTypes, allowDisregard: item.allowDisregard, position: item.position })) }, events: { create: { userId: member.userId, type: "CREATED", message: "Atividade gerada pela edição da rotina." } } };
      await tx.operationActivity.create({ data }); created++;
    }
    const transfer = responsibleChanged ? await reassignRoutine(tx, member, id, responsibleId) : { transferred: 0, pausedTimers: 0 };
    return { updated, removed, created, preserved, ...transfer };
  }, { maxWait: 10000, timeout: 50000 });
}
