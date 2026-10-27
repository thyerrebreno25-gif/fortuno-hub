import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { getOperationMember } from "@/modules/operations/auth";
import { analyticsPeriod, brazilDay, buildOperationsAnalytics, precedingPeriod, shiftDay } from "@/modules/operations/analytics";
export const maxDuration = 60;
const person = { id: true, name: true, email: true } as const;
const activitySelect = { id: true, title: true, status: true, scheduledDate: true, createdAt: true, dueAt: true, completedAt: true, responsibleId: true, team: true, clientCluster: true, client: { select: { id: true, name: true, cluster: true } }, process: { select: { id: true, name: true } }, responsible: { select: person } } as const;
const filters = z.object({ from: z.string().optional(), to: z.string().optional(), clientId: z.string().max(100).optional(), operatorId: z.string().max(100).optional(), processId: z.string().max(100).optional(), team: z.string().max(200).optional(), cluster: z.enum(["A", "B", "C"]).optional() });
export async function GET(request: Request) {
  try {
    const member = await getOperationMember();
    if (!member) return NextResponse.json({ error: "Sessão inválida ou sem permissão para consultar a operação." }, { status: 403 });
    const params = filters.parse(Object.fromEntries(new URL(request.url).searchParams)), today = brazilDay();
    let period;
    try { period = analyticsPeriod(params.from || `${today.slice(0, 7)}-01`, params.to || today); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Período inválido." }, { status: 400 }); }
    const ownOnly = member.role === "OPERATOR";
    if (ownOnly && params.operatorId && params.operatorId !== member.userId) return NextResponse.json({ error: "Seu perfil permite consultar apenas seus próprios apontamentos." }, { status: 403 });
    const operatorId = ownOnly ? member.userId : params.operatorId || undefined;
    const base: Prisma.OperationActivityWhereInput = { organizationId: member.organizationId, deletedAt: null,
      ...(params.clientId ? { clientId: params.clientId } : {}), ...(params.processId ? { processId: params.processId } : {}), ...(params.team ? { team: params.team } : {}), ...(params.cluster ? { clientCluster: params.cluster } : {}) };
    const previous = precedingPeriod(period), rangeStart = new Date(`${previous.from}T00:00:00Z`), rangeEnd = new Date(`${shiftDay(period.to, 1)}T00:00:00Z`);
    const [activities, entries, clients, members, processes, teams] = await Promise.all([
      prisma.operationActivity.findMany({ where: { ...base, ...(operatorId ? { responsibleId: operatorId } : {}), OR: [{ scheduledDate: { gte: rangeStart, lt: rangeEnd } }, { scheduledDate: null, createdAt: { gte: previous.start, lt: period.end } }] }, select: activitySelect, orderBy: { id: "asc" }, take: 20001 }),
      prisma.operationTimeEntry.findMany({ where: { ...(operatorId ? { userId: operatorId } : {}), startedAt: { lt: period.end }, OR: [{ endedAt: { gt: previous.start } }, { endedAt: null }], activity: base }, select: { id: true, activityId: true, userId: true, startedAt: true, endedAt: true, seconds: true, user: { select: person }, activity: { select: activitySelect } }, orderBy: { id: "asc" }, take: 100001 }),
      prisma.client.findMany({ where: { organizationId: member.organizationId, ...(ownOnly ? { operationActivities: { some: { deletedAt: null, OR: [{ responsibleId: member.userId }, { timeEntries: { some: { userId: member.userId } } }] } } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      prisma.organizationMember.findMany({ where: { organizationId: member.organizationId, role: { not: "CLIENT" }, ...(ownOnly ? { userId: member.userId } : {}) }, select: { user: { select: person } }, orderBy: { createdAt: "asc" } }),
      prisma.operationProcess.findMany({ where: { organizationId: member.organizationId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      prisma.operationActivity.findMany({ where: { organizationId: member.organizationId, deletedAt: null, team: { not: null }, ...(ownOnly ? { responsibleId: member.userId } : {}) }, distinct: ["team"], select: { team: true }, orderBy: { team: "asc" } }),
    ]);
    if (activities.length > 20000 || entries.length > 100000) return NextResponse.json({ error: "O período possui muitos registros. Reduza as datas ou filtre um cliente ou operador para consultar os totais completos." }, { status: 422 });
    const analytics = buildOperationsAnalytics(activities, entries, period, new Date(), operatorId);
    const result = { ...analytics, options: { clients, operators: members.map((item) => ({ id: item.user.id, name: item.user.name || item.user.email })), processes, teams: teams.map((item) => item.team).filter((team): team is string => Boolean(team)) }, ownOnly, currentUserId: member.userId };
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > 4000000) return NextResponse.json({ error: "O detalhamento deste período é muito extenso. Filtre por cliente, operador ou um período menor para obter o relatório completo." }, { status: 422 });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: "Confira os filtros informados." }, { status: 400 });
    return NextResponse.json({ error: "Não foi possível consultar o painel de tempo. Tente novamente." }, { status: 500 });
  }
}
