import {pendingDisregard} from "./disregard-policy";
import "server-only";
import {prisma} from "@/lib/prisma";
import {Prisma} from "@/generated/prisma/client";
import {canManageOperations,getOperationMember} from "./auth";
type Member=NonNullable<Awaited<ReturnType<typeof getOperationMember>>>;
export class OperationTimerError extends Error{constructor(message:string,public status:number){super(message);}}
export async function changeOperationTimer(member:Member,id:string,action:"start"|"stop"){
 if(member.canEdit===false)throw new OperationTimerError("Sem permissão para apontar tempo.",403);
 return prisma.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"operation-timer:"+member.userId}))`;
  const scope={userId:member.userId,endedAt:null,activity:{organizationId:member.organizationId}};
  const candidates=await tx.operationTimeEntry.findMany({where:scope,orderBy:{startedAt:"desc"}});
  const lockIds=[...new Set([id,...candidates.map(entry=>entry.activityId)])].sort();
  if(lockIds.length===1)await tx.$queryRaw`SELECT id FROM "OperationActivity" WHERE id=${id} AND "organizationId"=${member.organizationId} FOR UPDATE`;
  else await tx.$queryRaw(Prisma.sql`SELECT id FROM "OperationActivity" WHERE id IN (${Prisma.join(lockIds)}) AND "organizationId"=${member.organizationId} ORDER BY id FOR UPDATE`);
  const activity=await tx.operationActivity.findFirst({where:{id,organizationId:member.organizationId,deletedAt:null}});
  if(!activity)throw new OperationTimerError("Atividade não encontrada.",404);
  const active=await tx.operationTimeEntry.findMany({where:scope,orderBy:{startedAt:"desc"}});
  const now=new Date();
  if(action==="start"){
   if(pendingDisregard(activity.disregardReview))throw new OperationTimerError("A atividade aguarda a decisão do gestor.",409);
   if(!canManageOperations(member.role)&&activity.responsibleId!==member.userId)throw new OperationTimerError("Você só pode iniciar as atividades atribuídas a você.",403);
   if(["COMPLETED","DISREGARDED","BLOCKED"].includes(activity.status))throw new OperationTimerError("Atividade concluída, desconsiderada ou impedida não pode iniciar um cronômetro.",409);
  }
  const current=active.find(entry=>entry.activityId===id);
  for(const entry of active){
   if(action==="stop"&&entry.activityId!==id||action==="start"&&entry.id===current?.id)continue;
   const seconds=Math.max(0,Math.floor((+now-+entry.startedAt)/1000));
   const changed=await tx.operationTimeEntry.updateMany({where:{id:entry.id,userId:member.userId,endedAt:null},data:{endedAt:now,seconds}});
   if(changed.count){
    await tx.operationActivity.updateMany({where:{id:entry.activityId,organizationId:member.organizationId,status:"IN_PROGRESS",timeEntries:{none:{endedAt:null}}},data:{status:"PAUSED"}});
    await tx.operationEvent.create({data:{activityId:entry.activityId,userId:member.userId,type:"PAUSED",message:action==="start"?"Cronômetro pausado ao iniciar outra atividade.":`${member.user.name||member.user.email} pausou a atividade após ${Math.floor(seconds/60)}min ${seconds%60}s.`}});
   }
  }
  if(action==="stop")return {entry:current?{...current,endedAt:now,seconds:Math.max(0,Math.floor((+now-+current.startedAt)/1000))}:null};
  if(current){if(activity.status!=="IN_PROGRESS")await tx.operationActivity.update({where:{id},data:{status:"IN_PROGRESS"}});return {entry:current};}
  await tx.operationActivity.update({where:{id},data:{status:"IN_PROGRESS"}});
  const entry=await tx.operationTimeEntry.create({data:{activityId:id,userId:member.userId,startedAt:now}});
  await tx.operationEvent.create({data:{activityId:id,userId:member.userId,type:activity.status==="OPEN"?"STARTED":"RESUMED",message:`${member.user.name||member.user.email} ${activity.status==="OPEN"?"iniciou":"retomou"} a atividade.`}});
  return {entry};
 });
}
