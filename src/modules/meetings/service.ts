import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { actionEvent, actionInput, editableMeeting, meetingInput } from "./model";
import { findMeeting, MeetingError, type MeetingMember } from "./auth";

export async function saveMeeting(member: MeetingMember, body: unknown, id?: string) {
  const input = meetingInput.parse(body);
  const current = id ? await findMeeting(member, id) : null;
  const participantIds = [...new Set([...input.participantIds, current?.createdById || member.userId])];
  const members = await prisma.organizationMember.count({ where: { organizationId: member.organizationId, userId: { in: participantIds }, role: { not: "CLIENT" } } });
  if (members !== participantIds.length) throw new MeetingError("Selecione apenas colaboradores desta organização.");
  if (current && !editableMeeting(member, current)) throw new MeetingError("Somente o organizador ou um gestor pode editar esta reunião.", 403);
  const revision = id ? z.object({ revision: z.number().int().positive() }).parse(body).revision : 0;
  const { participantIds: _ids, ...data } = input;
  void _ids;
  return prisma.$transaction(async (tx) => {
    let meeting;
    if (id) {
      await tx.$queryRaw`SELECT "id" FROM "TeamMeeting" WHERE "id" = ${id} FOR UPDATE`;
      const invalidTasks = await tx.meetingActionItem.count({ where: { meetingId: id, responsibleId: { notIn: participantIds } } });
      if (invalidTasks) throw new MeetingError("Reatribua as entregas antes de remover o responsável dos participantes.");
      const changed = await tx.teamMeeting.updateMany({ where: { id, organizationId: member.organizationId, revision }, data: { ...data, revision: { increment: 1 } } });
      if (!changed.count) throw new MeetingError("A reunião foi alterada. Reabra para carregar a versão atual.", 409);
      meeting = await tx.teamMeeting.findUniqueOrThrow({ where: { id } });
      await tx.meetingParticipant.deleteMany({ where: { meetingId: id, userId: { notIn: participantIds } } });
    } else {
      meeting = await tx.teamMeeting.create({ data: { ...data, organizationId: member.organizationId, createdById: member.userId } });
    }
    await tx.meetingParticipant.createMany({ data: participantIds.map((userId) => ({ meetingId: meeting.id, userId })), skipDuplicates: true });
    await tx.teamCalendarEvent.updateMany({ where: { meetingId: meeting.id, actionItemId: null, userId: { notIn: participantIds } }, data: { status: "CANCELLED", googleSyncStatus: "PENDING", revision: { increment: 1 } } });
    for (const userId of participantIds) {
      const event = { title: meeting.title, description: meeting.agenda, startsAt: meeting.startsAt, endsAt: meeting.endsAt, location: [meeting.location, meeting.meetLink].filter(Boolean).join("\n"), status: meeting.status === "CANCELLED" ? "CANCELLED" : meeting.status === "COMPLETED" ? "COMPLETED" : "ACTIVE", googleSyncStatus: "PENDING" };
      await tx.teamCalendarEvent.upsert({ where: { userId_sourceKey: { userId, sourceKey: `meeting:${meeting.id}` } }, create: { ...event, organizationId: member.organizationId, userId, sourceKey: `meeting:${meeting.id}`, meetingId: meeting.id }, update: { ...event, revision: { increment: 1 } } });
    }
    if (meeting.status === "CANCELLED") await tx.teamCalendarEvent.updateMany({ where: { meetingId: meeting.id }, data: { status: "CANCELLED", googleSyncStatus: "PENDING", revision: { increment: 1 } } });
    if (current?.status === "CANCELLED" && meeting.status !== "CANCELLED") {
      const actions = await tx.meetingActionItem.findMany({ where: { meetingId: meeting.id } });
      for (const action of actions) await tx.teamCalendarEvent.updateMany({ where: { actionItemId: action.id, userId: action.responsibleId }, data: { ...actionEvent(action), googleSyncStatus: "PENDING", revision: { increment: 1 } } });
    }
    // Supersede invitation emails still waiting for delivery; only the latest details matter.
    await tx.meetingDelivery.updateMany({ where: { meetingId: meeting.id, actionItemId: null, emailStatus: "PENDING" }, data: { emailStatus: "SKIPPED" } });
    await tx.meetingDelivery.createMany({ data: participantIds.map((userId) => ({ organizationId: member.organizationId, userId, meetingId: meeting.id, dedupeKey: `meeting:${meeting.id}:${meeting.revision}:${userId}`, title: `${meeting.status === "CANCELLED" ? "Reunião cancelada" : id ? "Reunião atualizada" : "Convite de reunião"} · ${meeting.title}`, body: `${meeting.type} · ${meeting.startsAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}${meeting.location ? ` · ${meeting.location}` : ""}` })), skipDuplicates: true });
    return meeting;
  }, { timeout: 30000, maxWait: 10000 });
}

export async function saveAction(member: MeetingMember, meetingId: string, body: unknown, id?: string) {
  const meeting = await findMeeting(member, meetingId);
  if (meeting.status === "CANCELLED") throw new MeetingError("Esta reunião foi cancelada.");
  const manager = editableMeeting(member, meeting);
  const completion = z.object({ completed: z.boolean(), revision: z.number().int().positive() }).safeParse(body);
  return prisma.$transaction(async (tx) => {
    // Serialize changes to participants/cancellation with checklist edits.
    await tx.$queryRaw`SELECT "id" FROM "TeamMeeting" WHERE "id" = ${meetingId} FOR UPDATE`;
    const latest = await tx.teamMeeting.findUniqueOrThrow({ where: { id: meetingId }, include: { participants: { select: { userId: true } } } });
    if (latest.status === "CANCELLED") throw new MeetingError("Esta reunião foi cancelada.");
    if (!manager && !latest.participants.some((item) => item.userId === member.userId)) throw new MeetingError("Você não participa mais desta reunião.", 403);
    const previous = id ? await tx.meetingActionItem.findFirst({ where: { id, meetingId } }) : null;
    if (id && !previous) throw new MeetingError("Entrega não encontrada.", 404);
    if (previous && completion.success) {
      if (!manager && previous.responsibleId !== member.userId) throw new MeetingError("Somente o responsável ou organizador pode concluir esta entrega.", 403);
      const changed = await tx.meetingActionItem.updateMany({ where: { id, meetingId, revision: completion.data.revision }, data: { completedAt: completion.data.completed ? new Date() : null, revision: { increment: 1 } } });
      if (!changed.count) throw new MeetingError("A entrega foi alterada. Atualize a reunião.", 409);
    } else {
      const input = actionInput.parse(body);
      if (!manager && (!meeting.participants.some((item) => item.userId === member.userId) || input.responsibleId !== member.userId || (previous && previous.responsibleId !== member.userId))) throw new MeetingError("Você só pode definir suas próprias entregas.", 403);
      if (!latest.participants.some((item) => item.userId === input.responsibleId)) throw new MeetingError("O responsável deve participar da reunião.");
      if (id) {
        const { revision } = z.object({ revision: z.number().int().positive() }).parse(body);
        const changed = await tx.meetingActionItem.updateMany({ where: { id, meetingId, revision }, data: { ...input, revision: { increment: 1 } } });
        if (!changed.count) throw new MeetingError("A entrega foi alterada. Atualize a reunião.", 409);
      } else {
        const created = await tx.meetingActionItem.create({ data: { ...input, meetingId } });
        id = created.id;
      }
    }
    const action = await tx.meetingActionItem.findUniqueOrThrow({ where: { id: id! } });
    const event = { ...actionEvent(action), googleSyncStatus: "PENDING" };
    await tx.teamCalendarEvent.updateMany({ where: { actionItemId: action.id, userId: { not: action.responsibleId } }, data: { status: "CANCELLED", googleSyncStatus: "PENDING", revision: { increment: 1 } } });
    await tx.teamCalendarEvent.upsert({ where: { userId_sourceKey: { userId: action.responsibleId, sourceKey: `action:${action.id}` } }, create: { ...event, organizationId: member.organizationId, userId: action.responsibleId, sourceKey: `action:${action.id}`, meetingId, actionItemId: action.id }, update: { ...event, revision: { increment: 1 } } });
    await tx.meetingDelivery.updateMany({ where: { actionItemId: action.id, emailStatus: "PENDING" }, data: { emailStatus: "SKIPPED" } });
    if (!action.completedAt) await tx.meetingDelivery.create({ data: { organizationId: member.organizationId, userId: action.responsibleId, meetingId, actionItemId: action.id, dedupeKey: `assignment:${action.id}:${action.revision}`, title: `Entrega definida · ${action.title}`, body: `Prazo: ${action.dueAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · Reunião: ${meeting.title}` } });
    return action;
  }, { timeout: 30000, maxWait: 10000 });
}
