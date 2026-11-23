import { operationTeamCatalog } from "@/modules/operations/team-catalog";
import { canonicalTeam } from "@/modules/operations/teams";
import { routineScheduleKey } from "@/modules/operations/routine-schedule";
import { brazilDay } from "@/modules/operations/analytics";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canManageOperations, getOperationMember } from "@/modules/operations/auth";
import { generateActivitiesForConfigurationRange } from "@/modules/operations/recurrence";

export const maxDuration=60;

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export async function POST(request: Request) {
  try {
    const member = await getOperationMember();
    if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    if (!canManageOperations(member.role)||member.canEdit===false) return NextResponse.json({ error: "Sem permissão para configurar rotinas." }, { status: 403 });

    const body = (await request.json()) as Record<string, unknown>;
    const clientId = String(body.clientId || "");
    const processId = String(body.processId || "");
    if (!clientId || !processId) return NextResponse.json({ error: "Selecione cliente e processo." }, { status: 400 });

    const recurrence=body.recurrenceData as {weekdays?:unknown;monthDays?:unknown;startDate?:string;dailyMode?:string}|undefined;
    if((body.recurrenceType==="CUSTOM"||body.recurrenceType==="WEEKLY"||(body.recurrenceType==="DAILY"&&recurrence?.dailyMode==="CUSTOM_DAYS")) && (!Array.isArray(recurrence?.weekdays)||!recurrence.weekdays.length||recurrence.weekdays.some(day=>!Number.isInteger(day)||Number(day)<0||Number(day)>6)))return NextResponse.json({error:"Selecione dias da semana válidos para a recorrência."},{status:400});
    if(body.recurrenceType==="MONTHLY"&&(!Array.isArray(recurrence?.monthDays)||!recurrence.monthDays.length||recurrence.monthDays.some(day=>!Number.isInteger(day)||Number(day)<1||Number(day)>31)))return NextResponse.json({error:"Selecione dias do mês de 1 a 31 para a recorrência mensal."},{status:400});
    if(typeof body.responsibleId==="string"&&body.responsibleId){
      const responsible=await prisma.organizationMember.findFirst({where:{userId:body.responsibleId,organizationId:member.organizationId,role:{not:"CLIENT"}},select:{userId:true}});
      if(!responsible)return NextResponse.json({error:"Responsável não encontrado nesta organização."},{status:400});
    }
    const [client, process] = await Promise.all([
      prisma.client.findFirst({ where: { id: clientId, organizationId: member.organizationId } }),
      prisma.operationProcess.findFirst({ where: { id: processId, organizationId: member.organizationId } }),
    ]);
    if (!client || !process) return NextResponse.json({ error: "Cliente ou processo não encontrado." }, { status: 404 });

    const type = typeof body.recurrenceType === "string" ? body.recurrenceType : "ONCE";
    if (!["ONCE","DAILY","WEEKLY","MONTHLY","CUSTOM"].includes(type)) return NextResponse.json({error:"Recorrência inválida."},{status:400});
    const team = canonicalTeam(typeof body.team === "string" ? body.team : null);
    if (team && !(await operationTeamCatalog(member.organizationId)).options.includes(team)) return NextResponse.json({error:"Selecione uma equipe da lista."},{status:400});
    const resume = typeof body.resumeConfigurationId === "string" ? body.resumeConfigurationId : null;
    // Serialize schedule creation per organization/client/process, including retries.
    const saved = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"operations-reset-" + member.organizationId}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${member.organizationId + ":" + clientId + ":" + processId}))`;
      const existing = await tx.operationClientProcess.findMany({where:{clientId,processId,active:true,client:{organizationId:member.organizationId}},orderBy:{createdAt:"asc"}});
      if (resume) {
        const configuration = existing.find(row => row.id === resume);
        if (!configuration || routineScheduleKey(configuration.recurrenceType,configuration.recurrenceData) !== routineScheduleKey(type,body.recurrenceData)) return null;
        return {configuration, skipped:false};
      }
      const key = routineScheduleKey(type, body.recurrenceData);
      const same = existing.find(row => routineScheduleKey(row.recurrenceType,row.recurrenceData) === key);
      if (same) return {configuration:same,skipped:true};
      const configuration = await tx.operationClientProcess.create({data:{
        clientId,processId,
        responsibleId:typeof body.responsibleId === "string" && body.responsibleId ? body.responsibleId : null,
        team,
        recurrenceType:type as never,recurrenceData:(body.recurrenceData || {}) as never,
        notifyClient:body.notifyClient !== false,priority:(typeof body.priority === "string" ? body.priority : process.defaultPriority) as never,
        auditEnabled:body.auditEnabled === true,auditRecurrenceData:(body.auditRecurrenceData || null) as never,active:true,
      },include:{client:true,process:true,responsible:true}});
      return {configuration,skipped:false};
    },{maxWait:5000,timeout:10000});
    if (!saved) return NextResponse.json({error:"A rotina para retomar não corresponde a este cliente e processo."},{status:409});
    const {configuration} = saved;
    if (saved.skipped) return NextResponse.json({skipped:true,configurationId:configuration.id});

    const today=brazilDay();
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
