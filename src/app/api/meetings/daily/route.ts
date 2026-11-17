import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { meetingAccess, meetingFailure, MeetingError } from "@/modules/meetings/auth";
import { dailyScope } from "@/modules/meetings/daily-model";
import { processDailyActivities } from "@/modules/meetings/daily-server";
import { processMeetingBackground } from "@/modules/meetings/delivery";
export const maxDuration = 180;
export async function GET(request: Request) {
  try {
    const {member, permissions} = await meetingAccess();
    const params = new URL(request.url).searchParams;
    const scope = dailyScope(member, params.get("scope") === "all");
    const manager = ["MASTER", "ADMIN", "MANAGER"].includes(member.role);
    const status = params.get("status") || "pending", type = params.get("type") || "all";
    if (!["pending", "overdue", "completed", "all"].includes(status) || !["all", "Daily", "Semanal de squad"].includes(type)) throw new MeetingError("Filtro inválido.");
    await processDailyActivities(member.organizationId);
    after(() => processMeetingBackground(member.organizationId));
    const query = (params.get("q") || "").trim().slice(0, 180);
    const page = Math.max(0, Math.min(10000, Number(params.get("page")) || 0));
    const now = new Date();
    const base = {...scope, ...(type !== "all" ? {meeting: {...scope.meeting, type}} : {}), ...(query ? {OR: [{title: {contains: query, mode: "insensitive" as const}}, {meeting: {title: {contains: query, mode: "insensitive" as const}}}]} : {})};
    const state = status === "completed" ? {completedAt: {not: null}} : status === "overdue" ? {completedAt: null, dueAt: {lt: now}} : status === "pending" ? {completedAt: null} : {};
    const [actions, total, pending, overdue, completed] = await Promise.all([
      prisma.meetingActionItem.findMany({where: {...base, ...state}, include: {responsible: {select: {id: true, name: true, email: true}}, meeting: {select: {id: true, title: true, type: true}}}, orderBy: [{dueAt: "asc"}, {id: "asc"}], skip: Math.floor(page) * 30, take: 30}),
      prisma.meetingActionItem.count({where: {...base, ...state}}),
      prisma.meetingActionItem.count({where: {...base, completedAt: null}}),
      prisma.meetingActionItem.count({where: {...base, completedAt: null, dueAt: {lt: now}}}),
      prisma.meetingActionItem.count({where: {...base, completedAt: {not: null}}}),
    ]);
    return NextResponse.json({actions, total, summary: {pending, overdue, completed}, userId: member.userId, manager, canEdit: permissions.canEdit}, {headers: {"Cache-Control": "private, no-store"}});
  } catch (error) { return meetingFailure(error); }
}
