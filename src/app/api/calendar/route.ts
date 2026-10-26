import { after, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { meetingAccess, meetingFailure, MeetingError } from "@/modules/meetings/auth";
import { eventInput } from "@/modules/meetings/model";
import { googleConfigured, listGoogleEvents, syncCalendarEvents } from "@/modules/meetings/google-calendar";
export async function GET(request: Request) {
  try {
    const { member, permissions } = await meetingAccess("CALENDAR");
    const url = new URL(request.url);
    const now = new Date();
    const from = new Date(url.searchParams.get("from") || now.toISOString());
    const to = new Date(url.searchParams.get("to") || new Date(now.getTime() + 31 * 86400000).toISOString());
    if (!Number.isFinite(+from) || !Number.isFinite(+to) || from >= to || +to - +from > 93 * 86400000) throw new MeetingError("Selecione um intervalo válido de até 3 meses.");
    const [events, connection, pending] = await Promise.all([
      prisma.teamCalendarEvent.findMany({ where: { organizationId: member.organizationId, userId: member.userId, status: { not: "CANCELLED" }, startsAt: { lt: to }, endsAt: { gte: from } }, orderBy: { startsAt: "asc" }, take: 1001 }),
      prisma.googleCalendarConnection.findUnique({ where: { organizationId_userId: { organizationId: member.organizationId, userId: member.userId } }, select: { status: true, lastError: true } }),
      prisma.meetingActionItem.findMany({ where: { responsibleId: member.userId, completedAt: null, dueAt: { lte: new Date(Date.now() + 86400000) }, meeting: { organizationId: member.organizationId, status: { not: "CANCELLED" } } }, select: { id: true, title: true, dueAt: true, meetingId: true }, orderBy: { dueAt: "asc" }, take: 100 }),
    ]);
    let external: Awaited<ReturnType<typeof listGoogleEvents>> = [];
    let googleError = "";
    if (connection?.status === "CONNECTED") try { external = await listGoogleEvents(member.organizationId, member.userId, from, to); } catch (error) { googleError = error instanceof Error ? error.message : "Falha na consulta Google."; }
    return NextResponse.json({ events: events.slice(0, 1000), truncated: events.length > 1000, external, pending, connection, googleConfigured: googleConfigured(), googleError, permissions });
  } catch (error) { return meetingFailure(error); }
}
export async function POST(request: Request) {
  try {
    const { member } = await meetingAccess("CALENDAR", "canCreate");
    const input = eventInput.parse(await request.json());
    const event = await prisma.teamCalendarEvent.create({ data: { ...input, sourceKey: `manual:${crypto.randomUUID()}`, organizationId: member.organizationId, userId: member.userId } });
    after(async () => { await syncCalendarEvents({ organizationId: member.organizationId, userId: member.userId }); });
    return NextResponse.json({ event }, { status: 201 });
  } catch (error) { return meetingFailure(error); }
}
export async function PATCH(request: Request) {
  try {
    const { member } = await meetingAccess("CALENDAR", "canEdit");
    const body = await request.json();
    const { id, revision, cancelled } = z.object({ id: z.string().min(1), revision: z.number().int().positive(), cancelled: z.boolean().optional() }).parse(body);
    const event = await prisma.teamCalendarEvent.findFirst({ where: { id, organizationId: member.organizationId, userId: member.userId, sourceKey: { startsWith: "manual:" } } });
    if (!event) throw new MeetingError("Edite reuniões e entregas na Central de Reuniões.", 403);
    const data = cancelled ? { status: "CANCELLED" } : eventInput.parse(body);
    const updated = await prisma.teamCalendarEvent.updateMany({ where: { id, userId: member.userId, organizationId: member.organizationId, revision }, data: { ...data, revision: { increment: 1 }, googleSyncStatus: "PENDING" } });
    if (!updated.count) throw new MeetingError("O evento foi alterado. Atualize a agenda.", 409);
    after(async () => { await syncCalendarEvents({ organizationId: member.organizationId, userId: member.userId }); });
    return NextResponse.json({ ok: true });
  } catch (error) { return meetingFailure(error); }
}

export const maxDuration = 180;
