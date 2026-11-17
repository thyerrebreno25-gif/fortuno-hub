import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { meetingAccess, meetingFailure, findMeeting, MeetingError } from "@/modules/meetings/auth";
import { editableMeeting } from "@/modules/meetings/model";
import { canEditNote, canDeleteNote, noteEmojis, toggleNoteReaction } from "@/modules/meetings/note-model";
export async function POST(request: Request) {
  try {
    const { member } = await meetingAccess("MEETINGS", "canEdit");
    const { meetingId, body } = z.object({ meetingId: z.string().min(1), body: z.string().trim().min(1).max(10000) }).parse(await request.json());
    await findMeeting(member, meetingId);
    const note = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "TeamMeeting" WHERE "id" = ${meetingId} FOR UPDATE`;
      const meeting = await tx.teamMeeting.findUniqueOrThrow({where: {id: meetingId}, include: {participants: {select: {userId: true}}}});
      if (meeting.deletedAt || meeting.status === "CANCELLED") throw new MeetingError("A reunião foi cancelada.");
      if (!editableMeeting(member, meeting) && !meeting.participants.some(person => person.userId === member.userId)) throw new MeetingError("Você não participa mais desta reunião.", 403);
      return tx.meetingNote.create({ data: { meetingId, authorId: member.userId, body } });
    });
    return NextResponse.json({ note }, { status: 201 });
  } catch (error) { return meetingFailure(error); }
}

async function change(request: Request, remove = false) {
  try {
    const {member} = await meetingAccess("MEETINGS", "canEdit");
    const raw = await request.json();
    const {meetingId, id} = z.object({meetingId: z.string().min(1), id: z.string().min(1)}).parse(raw);
    await findMeeting(member, meetingId);
    const result = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "TeamMeeting" WHERE "id" = ${meetingId} FOR UPDATE`;
      const meeting = await tx.teamMeeting.findUniqueOrThrow({where: {id: meetingId}, include: {participants: {select: {userId: true}}}});
      if (meeting.deletedAt || meeting.status === "CANCELLED") throw new MeetingError("A reunião foi cancelada.");
      const manager = editableMeeting(member, meeting);
      if (!manager && !meeting.participants.some(person => person.userId === member.userId)) throw new MeetingError("Você não participa mais desta reunião.", 403);
      const note = await tx.meetingNote.findFirst({where: {id, meetingId}});
      if (!note) throw new MeetingError("Nota não encontrada.", 404);
      if (!remove && raw.action === "react") {
        const {emoji} = z.object({emoji: z.enum(noteEmojis)}).parse(raw);
        return tx.meetingNote.update({where: {id}, data: {reactions: toggleNoteReaction(note.reactions, member.userId, emoji)}});
      }
      const {revision} = z.object({revision: z.number().int().positive()}).parse(raw);
      if (revision !== note.revision) throw new MeetingError("A nota foi alterada. Atualize a reunião.", 409);
      if (remove) {
        if (!canDeleteNote(note.authorId, member.userId, manager)) throw new MeetingError("Somente o autor, responsável ou gestor pode excluir esta nota.", 403);
        await tx.meetingNote.delete({where: {id}});
      } else {
        if (!canEditNote(note.authorId, member.userId)) throw new MeetingError("Somente o autor pode editar esta nota.", 403);
        const {body} = z.object({body: z.string().trim().min(1).max(10000)}).parse(raw);
        await tx.meetingNote.update({where: {id}, data: {body, editedAt: new Date(), revision: {increment: 1}}});
      }
      await tx.auditLog.create({data: {userId: member.userId, action: remove ? "DELETE_MEETING_NOTE" : "EDIT_MEETING_NOTE", entity: "MeetingNote", entityId: id, afterData: {organizationId: member.organizationId, meetingId}}});
      return {ok: true};
    });
    return NextResponse.json(result);
  } catch (error) {return meetingFailure(error);}
}
export const PATCH = (request: Request) => change(request);
export const DELETE = (request: Request) => change(request, true);
