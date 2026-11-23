import {activityDuplicateGroups} from "@/modules/operations/activity-duplicates";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOperationMember } from "@/modules/operations/auth";
import { OperationTimerError } from "@/modules/operations/timer-server";
import { operationDayRange } from "@/modules/operations/activity-deadline";
import { bulkActivityDeletionSchema } from "@/modules/operations/bulk-delete-model";
import { deleteActivitiesForDay, requireBulkActivityDeletion } from "@/modules/operations/bulk-delete-server";
export const maxDuration = 60;
export async function GET(request: Request) {
  try {
    const member = await getOperationMember();
    if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    requireBulkActivityDeletion(member);
    const day = new URL(request.url).searchParams.get("day") || "";
    let scheduledDate;
    try { scheduledDate = operationDayRange(day); }
    catch { return NextResponse.json({ error: "Selecione uma data válida." }, { status: 400 }); }
    const activities = await prisma.operationActivity.findMany({ where: { organizationId: member.organizationId, deletedAt: null, scheduledDate }, select: { clientId:true, processId:true,id: true, title: true, status: true, updatedAt: true, client: { select: { name: true } }, responsible: { select: { name: true, email: true } } }, orderBy: [{ client: { name: "asc" } }, { title: "asc" }, { id: "asc" }], take: 2001 });
    if (activities.length > 2000) return NextResponse.json({ error: "Este dia possui mais de 2.000 atividades. Entre em contato com a gestão para dividir a seleção." }, { status: 422 });
    const duplicates=activityDuplicateGroups(activities);
    return NextResponse.json({ day, activities:activities.map(activity=>({...activity,duplicateCount:duplicates.get(activity.id)||0})) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof OperationTimerError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Não foi possível consultar as atividades do dia." }, { status: 500 });
  }
}
export async function POST(request: Request) {
  try {
    const member = await getOperationMember();
    if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    requireBulkActivityDeletion(member);
    const input = bulkActivityDeletionSchema.safeParse(await request.json().catch(() => null));
    if (!input.success) return NextResponse.json({ error: "Selecione de 1 a 2.000 atividades e informe uma justificativa com pelo menos 5 caracteres." }, { status: 400 });
    return NextResponse.json(await deleteActivitiesForDay(member, input.data));
  } catch (error) {
    if (error instanceof OperationTimerError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Não foi possível excluir a seleção. Atualize a lista e tente novamente." }, { status: 500 });
  }
}
