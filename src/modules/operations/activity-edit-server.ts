import "server-only";
import { prisma } from "@/lib/prisma";
import { canManageOperations, type getOperationMember } from "./auth";
import { pendingDisregard } from "./disregard-policy";
import { OperationTimerError } from "./timer-server";
import { activityInclude } from "./activity";
import type { ActivityEdit } from "./edit-model";
type Member = NonNullable<Awaited<ReturnType<typeof getOperationMember>>>;
export async function editOperationActivity(member: Member, id: string, input: ActivityEdit) {
  if (!canManageOperations(member.role) || member.canEdit === false) throw new OperationTimerError("Somente a gestão pode editar a programação das atividades.", 403);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "OperationActivity" WHERE id=${id} AND "organizationId"=${member.organizationId} FOR UPDATE`;
    const activity = await tx.operationActivity.findFirst({ where: { id, organizationId: member.organizationId, deletedAt: null } });
    if (!activity) throw new OperationTimerError("Atividade não encontrada.", 404);
    if (activity.updatedAt.toISOString() !== input.expectedUpdatedAt) throw new OperationTimerError("A atividade mudou. Reabra a edição para conferir os dados atuais.", 409);
    if (["COMPLETED", "DISREGARDED"].includes(activity.status) || pendingDisregard(activity.disregardReview)) throw new OperationTimerError("Edite apenas atividades abertas e sem aprovação pendente.", 409);
    if(activity.clientProcessId&&activity.scheduledDate?.toISOString().slice(0,10)!==input.day)throw new OperationTimerError("Para alterar os dias desta recorrência, edite a rotina em Rotinas configuradas.",409);
    await tx.operationActivity.update({ where: { id }, data: { title: input.title, description: input.description || null, scheduledDate: input.day ? new Date(input.day + "T00:00:00Z") : null, dueAt: input.day ? new Date(input.day + "T" + input.dueTime + ":00-03:00") : null, priority: input.priority, subjectToFine: input.subjectToFine } });
    await tx.operationEvent.create({ data: { activityId: id, userId: member.userId, type: "STATUS_CHANGED", message: `${member.user.name || member.user.email} editou os dados desta atividade.`, metadata: { action: "EDIT_ACTIVITY", before: { title: activity.title, description: activity.description, scheduledDate: activity.scheduledDate?.toISOString(), dueAt: activity.dueAt?.toISOString(), priority: activity.priority, subjectToFine: activity.subjectToFine }, after: input } } });
    return tx.operationActivity.findUnique({ where: { id }, include: activityInclude });
  });
}
