import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOperationMember } from "@/modules/operations/auth";
import { operationDayRange, operationToday, overdueActivityDates } from "@/modules/operations/activity-deadline";
import { analyticsPeriod } from "@/modules/operations/analytics";
const open = ["OPEN", "IN_PROGRESS", "PAUSED", "BLOCKED"] as const;
export async function GET(request: Request) {
  const member = await getOperationMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  const params = new URL(request.url).searchParams, today = operationToday();
  let period;
  try { period = analyticsPeriod(params.get("from") || today, params.get("to") || today); }
  catch { return NextResponse.json({ error: "Selecione um período válido de até 366 dias." }, { status: 400 }); }
  const scope = { organizationId: member.organizationId, deletedAt: null, ...(member.role === "OPERATOR" ? { responsibleId: member.userId } : {}) };
  const pending = { ...scope, status: { in: [...open] } };
  const scheduledDate = { gte: operationDayRange(period.from).gte, lt: operationDayRange(period.to).lt };
  try {
    const [overdue, fineRisk, blocked, awaitingApproval, dueToday, planned] = await Promise.all([
      prisma.operationActivity.count({ where: { ...pending, ...overdueActivityDates() } }),
      prisma.operationActivity.count({ where: { ...pending, subjectToFine: true, ...overdueActivityDates() } }),
      prisma.operationActivity.count({ where: { ...scope, status: "BLOCKED" } }),
      prisma.operationActivity.count({ where: { ...pending, disregardReview: { path: ["status"], equals: "PENDING" } } }),
      prisma.operationActivity.groupBy({ by: ["status"], where: { ...scope, OR:[{scheduledDate:operationDayRange(today)},{scheduledDate:null,dueAt:{gte:new Date(today+"T00:00:00-03:00"),lt:new Date(+new Date(today+"T00:00:00-03:00")+86400000)}}] }, _count: { _all: true } }),
      prisma.operationActivity.groupBy({ by: ["status"], where: { ...scope, OR: [{ scheduledDate }, { scheduledDate: null, dueAt: { gte: period.start, lt: period.end } }] }, _count: { _all: true } }),
    ]);
    const summarize = (rows: typeof planned) => {
      const total = rows.filter(row => row.status !== "DISREGARDED").reduce((sum, row) => sum + row._count._all, 0), completed = rows.find(row => row.status === "COMPLETED")?._count._all || 0;
      return { total, completed, open: total - completed };
    };
    return NextResponse.json({ today, from: period.from, to: period.to, ownOnly: member.role === "OPERATOR", attention: { overdue, fineRisk, blocked, awaitingApproval }, dueToday: summarize(dueToday), period: summarize(planned) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ error: "Não foi possível atualizar o resumo das atividades." }, { status: 500 }); }
}
