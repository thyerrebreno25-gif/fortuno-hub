import {overdueActivityDates} from "@/modules/operations/activity-deadline";
import { operationTeamCatalog } from "@/modules/operations/team-catalog";
import { operationClientTeam, canonicalTeam, activityTeamWhere } from "@/modules/operations/teams";
import { responsibleForProcess } from "@/modules/operations/responsible";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOperationMember } from "@/modules/operations/auth";
import { activityInclude, createEvent } from "@/modules/operations/activity";

function parseDateStart(value:string){
 const [year,month,day]=value.split("-").map(Number);
 return new Date(Date.UTC(year,month-1,day,0,0,0,0));
}

function parseNextDateStart(value:string){
 const [year,month,day]=value.split("-").map(Number);
 return new Date(Date.UTC(year,month-1,day+1,0,0,0,0));
}

export async function GET(request:Request){
 const member=await getOperationMember();if(!member)return NextResponse.json({error:"Sessão inválida."},{status:401});
 const u=new URL(request.url);const where:any={organizationId:member.organizationId,deletedAt:null};
 const from=u.searchParams.get("from"),to=u.searchParams.get("to"),status=u.searchParams.get("status"),clientId=u.searchParams.get("clientId"),requestedResponsibleId=u.searchParams.get("responsibleId"),processId=u.searchParams.get("processId"),team=u.searchParams.get("team"),priority=u.searchParams.get("priority"),cluster=u.searchParams.get("cluster"),pendingPrevious=u.searchParams.get("pendingPrevious")==="1";
 const catalog=await operationTeamCatalog(member.organizationId);
 const responsibleId=member.role==="OPERATOR"?member.userId:requestedResponsibleId;
 if(pendingPrevious){Object.assign(where,overdueActivityDates());where.status={in:["OPEN","IN_PROGRESS","PAUSED","BLOCKED"]};}
 else {if(from||to)where.scheduledDate={...(from?{gte:parseDateStart(from)}:{}),...(to?{lt:parseNextDateStart(to)}:{})};if(status)where.status=status;}
 if(clientId)where.clientId=clientId;if(responsibleId)where.responsibleId=responsibleId;if(processId)where.processId=processId;if(team)where.AND=[activityTeamWhere(team,catalog.values)];if(priority)where.priority=priority;if(cluster)where.clientCluster=cluster;
 const [activities,clients,processes,members,configurations,overdueCount,routineClients]=await Promise.all([
  prisma.operationActivity.findMany({where,orderBy:[{priority:"desc"},{subjectToFine:"desc"},{dueAt:"asc"},{createdAt:"desc"}],include:activityInclude,take:1501}),
  prisma.client.findMany({where:{organizationId:member.organizationId,active:true},orderBy:{name:"asc"},select:{id:true,name:true,operationalEmail:true,cluster:true,operationLeaderId:true}}),
  prisma.operationProcess.findMany({where:{organizationId:member.organizationId,active:true},orderBy:{name:"asc"},include:{checklistTemplates:{orderBy:{position:"asc"}}}}),
  prisma.organizationMember.findMany({where:{organizationId:member.organizationId,role:{not:"CLIENT"}},include:{user:{select:{id:true,name:true,email:true}}},orderBy:{createdAt:"asc"}}),
  ["MASTER","ADMIN","MANAGER"].includes(member.role)?prisma.operationClientProcess.findMany({where:{client:{organizationId:member.organizationId},active:true},include:{client:{select:{id:true,name:true,cluster:true}},process:{select:{id:true,name:true}},responsible:{select:{id:true,name:true,email:true}}},orderBy:{updatedAt:"desc"}}):Promise.resolve([]),
  prisma.operationActivity.count({where:{organizationId:member.organizationId,deletedAt:null,...overdueActivityDates(),status:{in:["OPEN","IN_PROGRESS","PAUSED","BLOCKED"]},...(responsibleId?{responsibleId}:{})}}),
  ["MASTER","ADMIN","MANAGER"].includes(member.role)?prisma.client.findMany({where:{organizationId:member.organizationId},orderBy:{name:"asc"},select:{id:true,name:true,cluster:true,active:true,notionSquad:true,serviceSquad:true}}):Promise.resolve([]),
 ]);
 return NextResponse.json({truncated:activities.length>1500,activities:activities.slice(0,1500).map(row=>({...row,team:canonicalTeam(row.team)||operationClientTeam(row.client)})),clients,routineClients:routineClients.map(c=>({...c,team:operationClientTeam(c)})),processes,teams:catalog.options,members:members.map(m=>m.user),configurations:configurations.map(row=>({...row,team:canonicalTeam(row.team)})),overdueCount,preferenceScope:member.organizationId+":"+member.userId,currentUserId:member.userId,currentRole:member.role,canEdit:member.canEdit,canManage:["MASTER","ADMIN","MANAGER"].includes(member.role),canDelete:["MASTER","ADMIN","MANAGER"].includes(member.role)});
}

export async function POST(request:Request){const member=await getOperationMember();if(!member)return NextResponse.json({error:"Sessão inválida."},{status:401});const body=await request.json() as any;if(!body.clientId||!body.processId)return NextResponse.json({error:"Cliente e processo são obrigatórios."},{status:400});const [process,client]=await Promise.all([prisma.operationProcess.findFirst({where:{id:body.processId,organizationId:member.organizationId},include:{checklistTemplates:{orderBy:{position:"asc"}}}}),prisma.client.findFirst({where:{id:body.clientId,organizationId:member.organizationId}})]);if(!process||!client)return NextResponse.json({error:"Cliente ou processo não encontrado."},{status:404});const team=canonicalTeam(typeof body.team==="string"?body.team:null);if(team&&!(await operationTeamCatalog(member.organizationId)).options.includes(team))return NextResponse.json({error:"Selecione uma equipe da lista."},{status:400});const activity=await prisma.operationActivity.create({data:{organizationId:member.organizationId,clientId:client.id,processId:process.id,responsibleId:body.responsibleId||responsibleForProcess(client,process),team:team||operationClientTeam(client),scheduledDate:body.scheduledDate?new Date(`${body.scheduledDate}T12:00:00.000Z`):null,title:body.title?.trim()||process.name,department:process.department,description:body.description?.trim()||process.description,dueAt:body.dueAt?new Date(body.dueAt):null,legalDate:body.legalDate?new Date(body.legalDate):null,competence:body.competence||null,subjectToFine:typeof body.subjectToFine==='boolean'?body.subjectToFine:process.subjectToFine,priority:body.priority||process.defaultPriority,clientCluster:client.cluster,checklistItems:{create:process.checklistTemplates.map(i=>({templateId:i.id,title:i.title,description:i.description,mandatory:i.mandatory,requiresComment:i.requiresComment,requiresAttachment:i.requiresAttachment,allowedFileTypes:i.allowedFileTypes,allowDisregard:i.allowDisregard,position:i.position}))}},include:activityInclude});await createEvent(activity.id,member.userId,"CREATED",`Atividade criada por ${member.user.name||member.user.email}.`);return NextResponse.json({activity},{status:201});}
