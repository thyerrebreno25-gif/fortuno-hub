import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { meetingAccess, meetingFailure, MeetingError } from "@/modules/meetings/auth";
import { listGoogleBusy } from "@/modules/meetings/google-calendar";
import { mergeBusy } from "@/modules/meetings/availability";

export const maxDuration = 180;
export async function GET(request: Request) {
  try {
    const { member } = await meetingAccess("CALENDAR");
    const url = new URL(request.url);
    const members = await prisma.organizationMember.findMany({ where: { organizationId: member.organizationId, role: { not: "CLIENT" } }, select: { user: { select: { id: true, name: true } } }, orderBy: { user: { name: "asc" } } });
    const people = members.map(item => item.user).filter(item => item.id !== member.userId);
    const headers = { "Cache-Control": "no-store" };
    if (url.searchParams.get("view") === "members") return NextResponse.json({ members: people }, { headers });
    const ids = [...new Set(url.searchParams.getAll("userId"))];
    if (!ids.length || ids.length > 6) throw new MeetingError("Selecione de 1 a 6 colegas para comparar as agendas.");
    if (ids.some(id => !people.some(person => person.id === id))) throw new MeetingError("Colaborador não disponível nesta equipe.", 403);
    const from = new Date(url.searchParams.get("from") || ""), to = new Date(url.searchParams.get("to") || "");
    if (!Number.isFinite(+from) || !Number.isFinite(+to) || from >= to || +to - +from > 93 * 86400000) throw new MeetingError("Selecione um período válido de até 3 meses.");
    const events = await prisma.teamCalendarEvent.findMany({ where: { organizationId: member.organizationId, userId: { in: ids }, status: { not: "CANCELLED" }, startsAt: { lt: to }, endsAt: { gt: from } }, select: { userId: true, startsAt: true, endsAt: true }, orderBy: { startsAt: "asc" }, take: 3001 });
    const availability = [];
    // Bound provider calls; no writes, deletions or sync jobs for other users.
    for (let offset = 0; offset < ids.length; offset += 3) {
      const batch = await Promise.all(ids.slice(offset, offset + 3).map(async userId => {
        let external: Awaited<ReturnType<typeof listGoogleBusy>> = null, googleStatus = "NOT_CONNECTED";
        try { external = await listGoogleBusy(member.organizationId, userId, from, to); if (external) googleStatus = "CONNECTED"; }
        catch { googleStatus = "UNAVAILABLE"; }
        const busy = mergeBusy([...events.filter(event => event.userId === userId), ...(external || [])], from, to);
        return { userId, name: people.find(person => person.id === userId)?.name || "Colaborador", googleStatus, busy };
      }));
      availability.push(...batch);
    }
    return NextResponse.json({ availability, truncated: events.length > 3000 }, { headers });
  } catch (error) { return meetingFailure(error); }
}
