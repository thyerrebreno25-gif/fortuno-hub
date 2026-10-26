import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { meetingAccess, meetingFailure, findMeeting } from "@/modules/meetings/auth";
export async function POST(request: Request) {
  try {
    const { member } = await meetingAccess("MEETINGS", "canEdit");
    const { meetingId, body } = z.object({ meetingId: z.string().min(1), body: z.string().trim().min(1).max(10000) }).parse(await request.json());
    await findMeeting(member, meetingId);
    const note = await prisma.meetingNote.create({ data: { meetingId, authorId: member.userId, body } });
    return NextResponse.json({ note }, { status: 201 });
  } catch (error) { return meetingFailure(error); }
}
