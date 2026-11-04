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

    const recurrence=body.recurrenceData as {weekdays?:unknown;startDate?:string;dailyMode?:string}|undefined;
    if(body.recurrenceType==="CUSTOM" && (!Array.isArray(recurrence?.weekdays)||!recurrence.weekdays.length||recurrence.weekdays.some(day=>!Number.isInteger(day)||Number(day)<0||Number(day)>6)))return NextResponse.json({error:"Selecione dias da semana válidos para a recorrência personalizada."},{status:400});
    if(typeof body.responsibleId==="string"&&body.responsibleId){
      const responsible=await prisma.organizationMember.findFirst({where:{userId:body.responsibleId,organizationId:member.organizationId,role:{not:"CLIENT"}},select:{userId:true}});
      if(!responsible)return NextResponse.json({error:"Responsável não encontrado nesta organização."},{status:400});
    }
    const [client, process] = await Promise.all([
      prisma.client.findFirst({ where: { id: clientId, organizationId: member.organizationId } }),
      prisma.operationProcess.findFirst({ where: { id: processId, organizationId: member.organizationId } }),
    ]);
    if (!client || !process) return NextResponse.json({ error: "Cliente ou processo não encontrado." }, { status: 404 });

    const previous = await prisma.operationClientProcess.findUnique({ where: { clientId_processId: { clientId, processId } }, select: { id: true, active: true } });
    const resume=typeof body.resumeConfigurationId==="string"?body.resumeConfigurationId:null;
    if(resume&&(!previous?.active||previous.id!==resume))return NextResponse.json({error:"A rotina para retomar não corresponde a este cliente e processo."},{status:409});
    if(!resume&&body.createOnly===true&&previous?.active)return NextResponse.json({skipped:true,configurationId:previous.id});
    if (previous && !previous.active) await prisma.operationActivity.updateMany({ where: { organizationId: member.organizationId, clientProcessId: previous.id, deletedAt: { not: null } }, data: { clientProcessId: null } });
    const configuration = resume ? previous! : await (body.createOnly===true&&!previous ? prisma.operationClientProcess.create({data:{
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
      },include:{client:true,process:true,responsible:true}}) : prisma.operationClientProcess.upsert({
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
    }));

    const today=new Date().toISOString().slice(0,10);
    const requestedStart=typeof recurrence?.startDate==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(recurrence.startDate)?recurrence.startDate:today;
    const from=new Date((requestedStart>today?requestedStart:today)+"T12:00:00Z");
    let generation;
    try{generation=await generateActivitiesForConfigurationRange(configuration.id, from, addDays(from, 89), member.userId);}
    catch{return NextResponse.json({error:"A rotina foi salva, mas a agenda não terminou de ser gerada. Tente novamente para retomar sem duplicar atividades.",configurationId:configuration.id},{status:503});}
    return NextResponse.json({ configuration, generation }, { status: 201 });
  } catch (error) {
    if((error as {code?:string})?.code==="P2002")return NextResponse.json({error:"Uma rotina deste processo já foi criada para o cliente. Atualize a lista antes de tentar novamente."},{status:409});
    console.error("Erro ao salvar rotina operacional:", error);
    return NextResponse.json({ error: "Não foi possível salvar a rotina. Tente novamente." }, { status: 500 });
  }
}
