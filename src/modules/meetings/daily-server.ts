import { prisma } from "@/lib/prisma";
import { actionEvent } from "./model";
import { dailyManagers, dailyMeetingTypes, nextBusinessDeadline } from "./daily-model";

/** Called by the cloud scheduler, also when opening Daily. All writes share a
 * transaction and the meeting lock used by saveAction, so retries cannot extend
 * a deadline twice or publish duplicate manager notices. No customer messages. */
export async function processDailyActivities(organizationId?: string, now = new Date()) {
  const candidates = await prisma.meetingActionItem.findMany({
    where: {completedAt: null, dueAt: {lt: now}, meeting: { ...(organizationId ? {organizationId} : {}), deletedAt: null, status: {not: "CANCELLED"}, type: {in: dailyMeetingTypes}}, OR: [{overdueNoticeId: null}, {autoExtendedAt: null, meeting: {type: "Daily"}}]},
    select: {id: true, meetingId: true}, orderBy: {dueAt: "asc"}, take: 60,
  });
  let processed = 0;
  const deadline = Date.now() + 45000;
  for (const candidate of candidates) {
    if (Date.now() > deadline) break;
    processed += await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "TeamMeeting" WHERE "id" = ${candidate.meetingId} FOR UPDATE`;
      const action = await tx.meetingActionItem.findUnique({where: {id: candidate.id}, include: {meeting: true, responsible: {select: {name: true, email: true}}}});
      if (!action || action.completedAt || action.dueAt >= now || action.meeting.deletedAt || action.meeting.status === "CANCELLED" || !dailyMeetingTypes.includes(action.meeting.type)) return 0;
      const org = action.meeting.organizationId;
      let dueAt = action.dueAt;
      const extend = action.meeting.type === "Daily" && !action.autoExtendedAt;
      if (extend) {
        const holidays = await tx.operationHoliday.findMany({where: {organizationId: org}, select: {date: true}});
        dueAt = nextBusinessDeadline(action.dueAt, holidays.map(item => item.date.toISOString().slice(0, 10)));
        await tx.meetingActionItem.update({where: {id: action.id}, data: {originalDueAt: action.originalDueAt || action.dueAt, autoExtendedAt: now, dueAt, revision: {increment: 1}}});
        const event = {...actionEvent({...action, dueAt}), googleSyncStatus: "PENDING"};
        await tx.teamCalendarEvent.upsert({where: {userId_sourceKey: {userId: action.responsibleId, sourceKey: `action:${action.id}`}}, create: {...event, organizationId: org, userId: action.responsibleId, meetingId: action.meetingId, actionItemId: action.id, sourceKey: `action:${action.id}`}, update: {...event, revision: {increment: 1}}});
        await tx.meetingDelivery.updateMany({where: {actionItemId: action.id, emailStatus: "PENDING"}, data: {emailStatus: "SKIPPED"}});
        await tx.meetingDelivery.createMany({data: [{organizationId: org, userId: action.responsibleId, meetingId: action.meetingId, actionItemId: action.id, dedupeKey: `daily-extension:${action.id}`, emailStatus: "SKIPPED", title: `Daily · prazo prorrogado uma única vez`, body: `${action.title} · Novo prazo: ${dueAt.toLocaleString("pt-BR", {timeZone: "America/Sao_Paulo"})}`}], skipDuplicates: true});
      }
      if (!action.overdueNoticeId) {
        const members = await tx.organizationMember.findMany({where: {organizationId: org, role: {not: "CLIENT"}}, select: {id: true, userId: true, role: true, teamLeaderId: true}});
        const owner = members.find(person => person.userId === action.responsibleId);
        const recipients = dailyManagers(members, owner?.teamLeaderId || null, action.meeting.responsibleId);
        const author = members.find(person => person.userId === (action.meeting.responsibleId || action.meeting.createdById)) || recipients[0];
        if (author && recipients.length) {
          const format = (date: Date) => date.toLocaleString("pt-BR", {timeZone: "America/Sao_Paulo"});
          const notice = await tx.notice.create({data: {organizationId: org, authorMemberId: author.id, kind: "ALERT", scope: "PERSONAL", priority: "HIGH", title: `Atividade não concluída · ${action.title}`.slice(0, 300), body: `Colaborador: ${action.responsible.name || action.responsible.email}\nReunião: ${action.meeting.title}\nPrazo original: ${format(action.originalDueAt || action.dueAt)}\n${extend || action.autoExtendedAt ? `Prorrogação única para o próximo dia útil: ${format(dueAt)}. Não haverá nova prorrogação automática.` : "Atividade em atraso."}\nAcompanhe em Atividades Daily ou na reunião: /reunioes?meeting=${action.meetingId}`, recipients: {create: recipients.map(person => ({memberId: person.id}))}}});
          await tx.meetingActionItem.update({where: {id: action.id}, data: {overdueNoticeId: notice.id}});
        }
      }
      return 1;
    }, {timeout: 15000, maxWait: 10000});
  }
  return {processed};
}
