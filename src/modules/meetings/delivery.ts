import { prisma } from "@/lib/prisma";
import { resolvePlatformEmailFrom } from "@/lib/email/platform-sender";
import { dayKey, reminderKey } from "./model";
import { syncCalendarEvents } from "./google-calendar";

export async function queueDailyReminders(now = new Date()) {
  const due = await prisma.meetingActionItem.findMany({ where: { completedAt: null, dueAt: { lte: new Date(now.getTime() + 24 * 3600_000) }, meeting: { status: { not: "CANCELLED" } } }, include: { meeting: { select: { title: true, organizationId: true } } }, take: 1000, orderBy: { dueAt: "asc" } });
  await prisma.meetingDelivery.createMany({ data: due.map((action) => ({ organizationId: action.meeting.organizationId, userId: action.responsibleId, meetingId: action.meetingId, actionItemId: action.id, dedupeKey: reminderKey(action, now), title: `${action.dueAt < now ? "Entrega atrasada" : "Entrega próxima"} · ${action.title}`, body: `${action.meeting.title} · Prazo: ${action.dueAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}` })), skipDuplicates: true });
  const meetings = await prisma.teamMeeting.findMany({ where: { status: "SCHEDULED", startsAt: { gte: now, lte: new Date(now.getTime() + 24 * 3600_000) } }, include: { participants: true }, take: 300, orderBy: { startsAt: "asc" } });
  const invitations = meetings.flatMap((meeting) => meeting.participants.map((participant) => ({ organizationId: meeting.organizationId, userId: participant.userId, meetingId: meeting.id, dedupeKey: `upcoming:${meeting.id}:${meeting.revision}:${participant.userId}:${dayKey(now)}`, title: `Sua próxima reunião · ${meeting.title}`, body: `${meeting.startsAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · ${meeting.type}` })));
  if (invitations.length) await prisma.meetingDelivery.createMany({ data: invitations, skipDuplicates: true });
  return { actions: due.length, meetings: meetings.length };
}
export async function deliverMeetingEmails(organizationId?: string) {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return { sent: 0, configured: false };
  const now = new Date();
  const rows = await prisma.meetingDelivery.findMany({ where: { ...(organizationId ? { organizationId } : {}), emailStatus: "PENDING", attempts: { lt: 8 }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] }, include: { user: { select: { email: true } }, actionItem: { select: { completedAt: true, responsibleId: true } }, meeting: { select: { status: true, meetLink: true } } }, orderBy: { createdAt: "asc" }, take: 40 });
  let sent = 0;
  const deadline = Date.now() + 45000;
  for (const row of rows) {
    if (Date.now() > deadline) break;
    if (row.actionItem && (row.actionItem.completedAt || row.actionItem.responsibleId !== row.userId || row.meeting.status === "CANCELLED")) { await prisma.meetingDelivery.update({ where: { id: row.id }, data: { emailStatus: "SKIPPED" } }); continue; }
    const claim = await prisma.meetingDelivery.updateMany({ where: { id: row.id, emailStatus: "PENDING", OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] }, data: { leaseUntil: new Date(Date.now() + 120_000), attempts: { increment: 1 } } });
    if (!claim.count) continue;
    try {
      const link = process.env.NEXT_PUBLIC_APP_URL ? new URL(`/reunioes?meeting=${encodeURIComponent(row.meetingId)}`, process.env.NEXT_PUBLIC_APP_URL).href : "";
      const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": row.dedupeKey }, body: JSON.stringify({ from: resolvePlatformEmailFrom([process.env.MEETINGS_FROM_EMAIL, process.env.OPERATIONS_FROM_EMAIL]), to: [row.user.email], subject: row.title, text: `${row.body}${row.meeting.meetLink ? `\nGoogle Meet: ${row.meeting.meetLink}` : ""}\n\n${link}` }), signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`O provedor de e-mail recusou o envio (${response.status}).`);
      await prisma.meetingDelivery.update({ where: { id: row.id }, data: { emailStatus: "SENT", sentAt: new Date(), lastError: null, leaseUntil: null } });
      sent++;
    } catch (error) {
      await prisma.meetingDelivery.update({ where: { id: row.id }, data: { lastError: error instanceof Error ? error.message : "Falha no envio.", leaseUntil: new Date(Date.now() + 10 * 60_000) } });
    }
  }
  return { sent, configured: true };
}
export async function processMeetingBackground(organizationId: string) {
  await Promise.allSettled([deliverMeetingEmails(organizationId), syncCalendarEvents({ organizationId })]);
}
