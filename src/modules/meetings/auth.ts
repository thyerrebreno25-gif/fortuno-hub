import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { getNoticeMember } from "@/modules/notices/server/notice-auth";
import { getRolePermissions, type PermissionShape } from "@/modules/permissions/permissions";

export class MeetingError extends Error { constructor(message: string, public status = 400) { super(message); } }
export async function meetingAccess(module: "MEETINGS" | "CALENDAR" = "MEETINGS", action: keyof PermissionShape = "canView") {
  const member = await getNoticeMember();
  if (!member) throw new MeetingError("Sessão inválida.", 401);
  const permissions = (await getRolePermissions(member.organizationId, member.role))[module];
  if (!permissions[action] || member.role === "CLIENT") throw new MeetingError("Seu perfil não permite esta ação.", 403);
  return { member, permissions };
}
export type MeetingMember = Awaited<ReturnType<typeof meetingAccess>>["member"];
export function meetingScope(member: MeetingMember) {
  return { organizationId: member.organizationId, ...(["MASTER", "ADMIN", "MANAGER"].includes(member.role) ? {} : { OR: [{ createdById: member.userId }, { participants: { some: { userId: member.userId } } }] }) };
}
export async function findMeeting(member: MeetingMember, id: string) {
  const meeting = await prisma.teamMeeting.findFirst({ where: { id, ...meetingScope(member) }, include: { participants: { select: { userId: true } } } });
  if (!meeting) throw new MeetingError("Reunião não encontrada.", 404);
  return meeting;
}
export function meetingFailure(error: unknown) {
  if (error instanceof ZodError) return NextResponse.json({ error: error.issues[0]?.message || "Dados inválidos." }, { status: 400 });
  if (error instanceof MeetingError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("Falha na central de reuniões:", error instanceof Error ? error.name : "Unknown");
  return NextResponse.json({ error: "Não foi possível concluir a ação. Tente novamente." }, { status: 500 });
}
