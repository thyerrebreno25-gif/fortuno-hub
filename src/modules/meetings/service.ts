import {createHash,randomUUID} from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { actionEvent, actionInput, editableMeeting, meetingInput } from "./model";
import { meetingOccurrences } from "./recurrence";
import { findMeeting, MeetingError, type MeetingMember } from "./auth";

export async function saveMeeting(member: MeetingMember, body: unknown, id?: string) {
  const input = meetingInput.parse(body);
  const current = id ? await findMeeting(member, id) : null;
  const responsibleId = input.responsibleId || current?.responsibleId || current?.createdById || member.userId;
  const manager = ["MASTER", "ADMIN", "MANAGER"].includes(member.role);
  if (responsibleId !== (current?.responsibleId || current?.createdById || member.userId) && !manager) throw new MeetingError("Somente gestores podem definir outro responsável pela reunião.", 403);
  if (id && input.recurrence) throw new MeetingError("Edite cada ocorrência individualmente. Para gerar novas datas, use Criar reunião.");
  const participantIds = [...new Set([...input.participantIds, responsibleId])];
  const members = await prisma.organizationMember.count({ where: { organizationId: member.organizationId, userId: { in: participantIds }, role: { not: "CLIENT" } } });
  if (members !== participantIds.length) throw new MeetingError("Selecione apenas colaboradores desta organização.");
  if (current && !editableMeeting(member, current)) throw new MeetingError("Somente o organizador ou um gestor pode editar esta reunião.", 403);
  const revision = id ? z.object({ revision: z.number().int().positive() }).parse(body).revision : 0;
  const { participantIds: _ids, recurrence, creationKey, responsibleId: _responsible, ...fields } = input;
  void _ids; void _responsible;
  const data = { ...fields, responsibleId };
  if (!id) {
    const occurrences = meetingOccurrences(input.startsAt, input.endsAt, recurrence);
    if (recurrence && input.status !== "SCHEDULED") throw new MeetingError("Novas reuniões recorrentes devem estar agendadas.");
    if (occurrences.length * participantIds.length > 3000) throw new MeetingError("Reduza o período ou os participantes para gerar até 3.000 compromissos por vez.");
    const key = creationKey || randomUUID();
    const hash = createHash("sha256").update(JSON.stringify({ data, participantIds: [...participantIds].sort(), recurrence: recurrence || null })).digest("hex");
    return prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${member.organizationId}:meeting:${key}`}))`;
      const existing = await tx.teamMeeting.findMany({ where: { organizationId: member.organizationId, creationKey: key }, orderBy: { startsAt: "asc" } });
      if (existing.length) {
        if (existing.some(meeting => meeting.createdById !== member.userId || meeting.creationHash !== hash)) throw new MeetingError("Esta solicitação já foi salva com outros dados. Reabra o formulário.", 409);
        return { ...existing[0], createdCount: existing.length };
      }
      const meetings = await tx.teamMeeting.createManyAndReturn({ data: occurrences.map(dates => ({ ...data, ...dates, id: randomUUID(), organizationId: member.organizationId, createdById: member.userId, creationKey: key, creationHash: hash, ...(recurrence ? { recurrenceData: recurrence } : {}) })) });
      meetings.sort((a,b) => +a.startsAt - +b.startsAt);
      await tx.meetingParticipant.createMany({ data: meetings.flatMap(meeting => participantIds.map(userId => ({ meetingId: meeting.id, userId }))), skipDuplicates: true });
      await tx.teamCalendarEvent.createMany({ data: meetings.flatMap(meeting => participantIds.map(userId => ({ organizationId: member.organizationId, userId, meetingId: meeting.id, sourceKey: `meeting:${meeting.id}`, title: meeting.title, description: meeting.agenda, startsAt: meeting.startsAt, endsAt: meeting.endsAt, location: meeting.location, status: meeting.status === "CANCELLED" ? "CANCELLED" : meeting.status === "COMPLETED" ? "COMPLETED" : "ACTIVE", googleSyncStatus: "PENDING" }))), skipDuplicates: true });
      await tx.meetingDelivery.createMany({ data: meetings.flatMap(meeting => participantIds.map(userId => ({ organizationId: member.organizationId, userId, meetingId: meeting.id, dedupeKey: `meeting:${meeting.id}:${meeting.revision}:${userId}`, title: `Convite de reunião · ${meeting.title}`, body: `${meeting.type} · ${meeting.startsAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}${meeting.location ? ` · ${meeting.location}` : ""}` }))), skipDuplicates: true });
      return { ...meetings[0], createdCount: meetings.length };
    }, { timeout: 30000, maxWait: 10000 });
  }
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
    } else { throw new MeetingError("Informe a reunião."); }
    if (current?.fathomEnabled && !meeting.fathomEnabled) await tx.meetingReport.updateMany({where:{meetingId:meeting.id,includeRecordings:true,status:{in:["PENDING","PROCESSING","WAITING_AUDIO"]}},data:{includeRecordings:false,generation:randomUUID(),status:"PENDING",claimedAt:null,nextRunAt:new Date()}});
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
    await tx.meetingDelivery.createMany({ data: participantIds.map((userId) => ({ organizationId: member.organizationId, userId, meetingId: meeting.id, dedupeKey: `${meeting.status === "CANCELLED" ? "meeting-cancelled" : "meeting"}:${meeting.id}:${meeting.revision}:${userId}`, title: `${meeting.status === "CANCELLED" ? "Reunião cancelada" : id ? "Reunião atualizada" : "Convite de reunião"} · ${meeting.title}`, body: `${meeting.type} · ${meeting.startsAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}${meeting.location ? ` · ${meeting.location}` : ""}` })), skipDuplicates: true });
    return { ...meeting, createdCount: 1 };
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
    if (latest.deletedAt || latest.status === "CANCELLED") throw new MeetingError("Esta reunião foi cancelada.");
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

export async function trashMeeting(member: MeetingMember, id: string, revision: number, restore = false) {
  const current = await findMeeting(member, id, restore);
  if (!editableMeeting(member, current)) throw new MeetingError("Somente o organizador ou um gestor pode excluir ou restaurar esta reunião.", 403);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "TeamMeeting" WHERE "id" = ${id} FOR UPDATE`;
    const changed = await tx.teamMeeting.updateMany({where:{id,organizationId:member.organizationId,revision,deletedAt:restore?{not:null}:null},data:{deletedAt:restore?null:new Date(),status:"CANCELLED",revision:{increment:1}}});
    if(!changed.count) throw new MeetingError("A reunião foi alterada. Atualize a tela antes de continuar.",409);
    await tx.teamCalendarEvent.updateMany({where:{organizationId:member.organizationId,meetingId:id},data:{status:"CANCELLED",googleSyncStatus:"PENDING",revision:{increment:1}}});
    await tx.meetingDelivery.updateMany({where:{organizationId:member.organizationId,meetingId:id,emailStatus:"PENDING"},data:{emailStatus:"SKIPPED"}});
    if(!restore) await tx.meetingDelivery.createMany({data:current.participants.map(person=>({organizationId:member.organizationId,userId:person.userId,meetingId:id,dedupeKey:`meeting-deleted:${id}:${revision+1}:${person.userId}`,title:`Reunião excluída · ${current.title}`,body:"A reunião foi retirada da agenda. Os compromissos vinculados serão cancelados.",emailStatus:"SKIPPED"})),skipDuplicates:true});
    await tx.auditLog.create({data:{userId:member.userId,action:restore?"RESTORE_MEETING":"TRASH_MEETING",entity:"TeamMeeting",entityId:id,beforeData:{organizationId:member.organizationId,status:current.status,revision},afterData:{status:"CANCELLED",deleted:!restore,revision:revision+1}}});
    return {ok:true,restored:restore};
  },{timeout:30000,maxWait:10000});
}

export async function ensurePersonalMeetingEvents(organizationId:string,userId:string) {
 return prisma.$transaction(async tx=>{
  const where={organizationId,deletedAt:null,status:{not:"CANCELLED"},participants:{some:{userId}},events:{none:{userId,actionItemId:null,sourceKey:{startsWith:"meeting:"}}}};
  const candidates=await tx.teamMeeting.findMany({where,take:100,orderBy:{createdAt:"desc"},select:{id:true}});
  if(!candidates.length) return 0;
  // Serialize legacy-event repair with deletion and participant edits.
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "TeamMeeting" WHERE "id" IN (${Prisma.join(candidates.map(meeting=>meeting.id))}) ORDER BY "id" FOR UPDATE`);
  const meetings=await tx.teamMeeting.findMany({where:{...where,id:{in:candidates.map(meeting=>meeting.id)}},select:{id:true,title:true,agenda:true,startsAt:true,endsAt:true,location:true,meetLink:true,status:true}});
  if(!meetings.length) return 0;
  const result=await tx.teamCalendarEvent.createMany({data:meetings.map(meeting=>({organizationId,userId,meetingId:meeting.id,sourceKey:`meeting:${meeting.id}`,title:meeting.title,description:meeting.agenda,startsAt:meeting.startsAt,endsAt:meeting.endsAt,location:[meeting.location,meeting.meetLink].filter(Boolean).join("\n"),status:meeting.status==="COMPLETED"?"COMPLETED":"ACTIVE",googleSyncStatus:"PENDING"})),skipDuplicates:true});
  return result.count;
 },{timeout:30000,maxWait:10000});
}
