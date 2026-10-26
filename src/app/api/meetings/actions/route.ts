import { after, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { meetingAccess, meetingFailure, findMeeting, MeetingError } from "@/modules/meetings/auth";
import { saveAction } from "@/modules/meetings/service";
import { editableMeeting } from "@/modules/meetings/model";
import { processMeetingBackground } from "@/modules/meetings/delivery";

async function save(request: Request, update: boolean) {
  try {
    const { member } = await meetingAccess("MEETINGS", "canEdit");
    const body = await request.json();
    const { meetingId, id } = z.object({ meetingId: z.string().min(1), id: update ? z.string().min(1) : z.string().optional() }).parse(body);
    const action = await saveAction(member, meetingId, body, update ? id : undefined);
    after(() => processMeetingBackground(member.organizationId));
    return NextResponse.json({ action });
  } catch (error) { return meetingFailure(error); }
}
export const POST = (request: Request) => save(request, false);
export const PATCH = (request: Request) => save(request, true);
export async function DELETE(request: Request) {
  try {
    const { member } = await meetingAccess("MEETINGS", "canEdit");
    const { meetingId, id, revision } = z.object({ meetingId: z.string().min(1), id: z.string().min(1), revision: z.number().int().positive() }).parse(await request.json());
    const meeting = await findMeeting(member, meetingId);
    if (!editableMeeting(member, meeting)) throw new MeetingError("Somente o organizador ou gestor pode excluir entregas.", 403);
    await prisma.$transaction(async (tx) => {
      const action = await tx.meetingActionItem.findFirst({ where: { id, meetingId, revision } });
      if (!action) throw new MeetingError("A entrega foi alterada. Atualize a reunião.", 409);
      await tx.teamCalendarEvent.updateMany({ where: { actionItemId: id }, data: { status: "CANCELLED", googleSyncStatus: "PENDING", revision: { increment: 1 } } });
      const result = await tx.meetingActionItem.deleteMany({ where: { id, meetingId, revision } });
      if (!result.count) throw new MeetingError("A entrega foi alterada. Atualize a reunião.", 409);
    });
    after(() => processMeetingBackground(member.organizationId));
    return NextResponse.json({ ok: true });
  } catch (error) { return meetingFailure(error); }
}

export const maxDuration = 180;
