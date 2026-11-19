import "server-only";
import {Prisma} from "@/generated/prisma/client";
import {prisma} from "@/lib/prisma";
import {getRolePermissions} from "@/modules/permissions/permissions";
import {canManageOperations,type getOperationMember} from "./auth";
import {OperationTimerError} from "./timer-server";
import {transferableStatuses,type ActivityTransfer} from "./transfer-model";
type Member=NonNullable<Awaited<ReturnType<typeof getOperationMember>>>;
export function requireActivityTransfer(member:Member){
 if(member.canEdit===false||member.role==="CLIENT")throw new OperationTimerError("Sem permissão para transferir atividades.",403);
}
export function transferActivityScope(member:Member,ids:string[]):Prisma.OperationActivityWhereInput{
 return {id:{in:ids},organizationId:member.organizationId,deletedAt:null,status:{in:[...transferableStatuses]},...(!canManageOperations(member.role)?{responsibleId:member.userId}:{})};
}
async function eligibleRoles(organizationId:string,roles:Member["role"][]){
 const permissions=await Promise.all([...new Set(roles)].map(async role=>({role,permissions:(await getRolePermissions(organizationId,role)).OPERATIONS})));
 return new Set(permissions.filter(item=>item.permissions.canView&&item.permissions.canEdit).map(item=>item.role));
}
export async function previewActivityTransfer(member:Member,ids:string[]){
 requireActivityTransfer(member);
 const activities=await prisma.operationActivity.findMany({where:transferActivityScope(member,ids),select:{id:true,title:true,status:true,updatedAt:true,client:{select:{name:true}},responsibleId:true,responsible:{select:{name:true,email:true}}},orderBy:[{client:{name:"asc"}},{title:"asc"},{id:"asc"}]});
 if(activities.length!==ids.length)throw new OperationTimerError("Uma atividade não está mais disponível para transferência ou não pertence a você. Atualize a seleção.",409);
 const members=await prisma.organizationMember.findMany({where:{organizationId:member.organizationId,role:{not:"CLIENT"}},select:{role:true,user:{select:{id:true,name:true,email:true}}},orderBy:{user:{name:"asc"}}});
 const roles=await eligibleRoles(member.organizationId,members.map(item=>item.role));
 return {activities,operators:members.filter(item=>roles.has(item.role)).map(item=>item.user)};
}
export async function transferActivities(member:Member,input:ActivityTransfer){
 requireActivityTransfer(member);
 const destination=await prisma.organizationMember.findFirst({where:{organizationId:member.organizationId,userId:input.responsibleId,role:{not:"CLIENT"}},select:{role:true,user:{select:{id:true,name:true,email:true}}}});
 if(!destination||!(await eligibleRoles(member.organizationId,[destination.role])).has(destination.role))throw new OperationTimerError("Selecione um colaborador desta organização com acesso às atividades.",400);
 const ids=input.activities.map(item=>item.id);
 return prisma.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"operations-reset-"+member.organizationId}))`;
  await tx.$queryRaw`SELECT "userId" FROM "OrganizationMember" WHERE "organizationId"=${member.organizationId} AND "userId"=${input.responsibleId} FOR SHARE`;
  const currentDestination=await tx.organizationMember.findFirst({where:{organizationId:member.organizationId,userId:input.responsibleId,role:destination.role},select:{userId:true}});
  if(!currentDestination)throw new OperationTimerError("O acesso do destinatário mudou. Atualize a seleção.",409);
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "OperationActivity" WHERE "organizationId"=${member.organizationId} AND id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
  const activities=await tx.operationActivity.findMany({where:transferActivityScope(member,ids),select:{id:true,responsibleId:true,updatedAt:true,responsible:{select:{name:true,email:true}}}});
  const versions=new Map(input.activities.map(item=>[item.id,item.updatedAt]));
  if(activities.length!==ids.length||activities.some(item=>versions.get(item.id)!==item.updatedAt.toISOString()))throw new OperationTimerError("Uma atividade foi alterada, concluída ou transferida após a revisão. Atualize a seleção para conferir.",409);
  const changed=activities.filter(item=>item.responsibleId!==input.responsibleId),changedIds=changed.map(item=>item.id);
  if(!changed.length)return {transferredIds:[],unchanged:activities.length,pausedTimers:0};
  const now=new Date(),timers=await tx.operationTimeEntry.findMany({where:{activityId:{in:changedIds},endedAt:null},select:{id:true,startedAt:true}});
  let pausedTimers=0;
  for(const timer of timers){const result=await tx.operationTimeEntry.updateMany({where:{id:timer.id,endedAt:null},data:{endedAt:now,seconds:Math.max(0,Math.floor((+now-+timer.startedAt)/1000))}});pausedTimers+=result.count;}
  const result=await tx.operationActivity.updateMany({where:transferActivityScope(member,changedIds),data:{responsibleId:input.responsibleId}});
  if(result.count!==changedIds.length)throw new OperationTimerError("A seleção mudou durante a transferência. Atualize a lista.",409);
  await tx.operationActivity.updateMany({where:{id:{in:changedIds},organizationId:member.organizationId,status:"IN_PROGRESS",timeEntries:{none:{endedAt:null}}},data:{status:"PAUSED"}});
  await tx.operationEvent.createMany({data:changed.map(item=>({activityId:item.id,userId:member.userId,type:"ASSIGNED" as const,message:`${member.user.name||member.user.email} transferiu a atividade de ${item.responsible?.name||item.responsible?.email||"Sem responsável"} para ${destination.user.name||destination.user.email}.${input.reason?` Observação: ${input.reason}`:""}`,metadata:{fromResponsibleId:item.responsibleId,toResponsibleId:input.responsibleId,reason:input.reason,batch:ids.length>1}}))});
  return {transferredIds:changedIds,unchanged:activities.length-changed.length,pausedTimers};
 },{maxWait:10000,timeout:30000});
}
