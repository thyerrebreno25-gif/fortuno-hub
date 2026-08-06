import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canManageOperations, getOperationMember } from "@/modules/operations/auth";
import { generateActivitiesForConfigurationRange } from "@/modules/operations/recurrence";

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export async function POST(request: Request) {
  try {
    const member = await getOperationMember();
    if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    if (!canManageOperations(member.role)) return NextResponse.json({ error: "Sem permissão para configurar rotinas." }, { status: 403 });

    const body = (await request.json()) as Record<string, unknown>;
    const clientId = String(body.clientId || "");
    const processId = String(body.processId || "");
    if (!clientId || !processId) return NextResponse.json({ error: "Selecione cliente e processo." }, { status: 400 });

    const [client, process] = await Promise.all([
      prisma.client.findFirst({ where: { id: clientId, organizationId: member.organizationId } }),
      prisma.operationProcess.findFirst({ where: { id: processId, organizationId: member.organizationId } }),
    ]);
    if (!client || !process) return NextResponse.json({ error: "Cliente ou processo não encontrado." }, { status: 404 });

    const configuration = await prisma.operationClientProcess.upsert({
      where: { clientId_processId: { clientId, processId } },
      create: {
        clientId, processId,
        responsibleId: typeof body.responsibleId === "string" && body.responsibleId ? body.responsibleId : null,
        team: typeof body.team === "string" && body.team.trim() ? body.team.trim() : null,
        recurrenceType: typeof body.recurrenceType === "string" ? body.recurrenceType as never : "ONCE",
        recurrenceData: (body.recurrenceData || {}) as never,
        notifyClient: body.notifyClient !== false,
        priority: (typeof body.priority === "string" ? body.priority : process.defaultPriority) as never,
        auditEnabled: body.auditEnabled === true,
        auditRecurrenceData: (body.auditRecurrenceData || null) as never,
        active: true,
      },
      update: {
        responsibleId: typeof body.responsibleId === "string" && body.responsibleId ? body.responsibleId : null,
        team: typeof body.team === "string" && body.team.trim() ? body.team.trim() : null,
        recurrenceType: typeof body.recurrenceType === "string" ? body.recurrenceType as never : "ONCE",
        recurrenceData: (body.recurrenceData || {}) as never,
        notifyClient: body.notifyClient !== false,
        priority: (typeof body.priority === "string" ? body.priority : process.defaultPriority) as never,
        auditEnabled: body.auditEnabled === true,
        auditRecurrenceData: (body.auditRecurrenceData || null) as never,
        active: true,
      },
      include: { client: true, process: true, responsible: true },
    });

    const generation = await generateActivitiesForConfigurationRange(configuration.id, new Date(), addDays(new Date(), 90), member.userId);
    return NextResponse.json({ configuration, generation }, { status: 201 });
  } catch (error) {
    console.error("Erro ao salvar rotina operacional:", error);
    return NextResponse.json({ error: "Não foi possível salvar a rotina. Tente novamente." }, { status: 500 });
  }
}
