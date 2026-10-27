import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { meetingAccess, meetingFailure, meetingScope, findMeeting } from "@/modules/meetings/auth";
import { saveMeeting } from "@/modules/meetings/service";
import { processMeetingBackground } from "@/modules/meetings/delivery";
import { googleConfigured, syncCalendarEvents } from "@/modules/meetings/google-calendar";

export async function GET(request: Request) {
  try {
    const { member, permissions } = await meetingAccess();
    const url = new URL(request.url);
    if (url.searchParams.get("view") === "options") {
      const members = await prisma.organizationMember.findMany({ where: { organizationId: member.organizationId, role: { not: "CLIENT" } }, select: { user: { select: { id: true, name: true, email: true } } }, orderBy: { user: { name: "asc" } } });
      const google = await prisma.googleCalendarConnection.findUnique({ where: { organizationId_userId: { organizationId: member.organizationId, userId: member.userId } }, select: { status: true } });
      return NextResponse.json({ googleConnected: google?.status === "CONNECTED", userId: member.userId, permissions, members: members.map((item) => item.user), emailConfigured: Boolean(process.env.RESEND_API_KEY), remindersConfigured: Boolean(process.env.CRON_SECRET), recordingConfigured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY), transcriptionConfigured: Boolean(process.env.OPENAI_API_KEY), googleConfigured: googleConfigured() });
    }
    const id = url.searchParams.get("id");
    if (id) {
      await findMeeting(member, id);
      const meeting = await prisma.teamMeeting.findFirstOrThrow({ where: { id, ...meetingScope(member) }, include: { creator: { select: { id: true, name: true } }, participants: { include: { user: { select: { id: true, name: true, email: true } } } }, actions: { include: { responsible: { select: { id: true, name: true, email: true } } }, orderBy: { dueAt: "asc" } }, contributions: { include: { author: { select: { name: true, email: true } } }, orderBy: { createdAt: "asc" } }, recordings: { select: { id: true, name: true, status: true, transcript: true, error: true, size: true, createdAt: true }, orderBy: { createdAt: "desc" } } } });
      const integration = await prisma.teamCalendarEvent.findFirst({ where: { meetingId: meeting.id, userId: meeting.createdById, actionItemId: null }, select: { googleSyncStatus: true, syncError: true } });
      return NextResponse.json({ meeting: { ...meeting, integration }, canManage: meeting.createdById === member.userId || ["MASTER", "ADMIN", "MANAGER"].includes(member.role) });
    }
    const page = Math.min(100, Math.max(0, Number(url.searchParams.get("page")) || 0));
    const q = (url.searchParams.get("q") || "").slice(0, 180);
    const meetings = await prisma.teamMeeting.findMany({ where: { ...meetingScope(member), ...(q ? { AND: [{ OR: [{ title: { contains: q, mode: "insensitive" } }, { type: { contains: q, mode: "insensitive" } }] }] } : {}) }, include: { _count: { select: { participants: true, actions: true } }, actions: { select: { completedAt: true } } }, orderBy: [{ startsAt: "desc" }, { id: "desc" }], take: 51, skip: page * 50 });
    return NextResponse.json({ meetings: meetings.slice(0, 50), hasMore: meetings.length > 50 });
  } catch (error) { return meetingFailure(error); }
}
export async function POST(request: Request) {
  try {
    const { member } = await meetingAccess("MEETINGS", "canCreate");
    const meeting = await saveMeeting(member, await request.json());
    await syncCalendarEvents({ organizationId: member.organizationId, meetingId: meeting.id });
    after(() => processMeetingBackground(member.organizationId));
    return NextResponse.json({ meeting }, { status: 201 });
  } catch (error) { return meetingFailure(error); }
}
export async function PATCH(request: Request) {
  try {
    const { member } = await meetingAccess("MEETINGS", "canEdit");
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Informe a reunião." }, { status: 400 });
    const meeting = await saveMeeting(member, await request.json(), id);
    await syncCalendarEvents({ organizationId: member.organizationId, meetingId: meeting.id });
    after(() => processMeetingBackground(member.organizationId));
    return NextResponse.json({ meeting });
  } catch (error) { return meetingFailure(error); }
}

export const maxDuration = 180;
