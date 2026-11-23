import "server-only";
import {randomUUID} from "node:crypto";
import {prisma} from "@/lib/prisma";
import {canManageOperations,getOperationMember} from "./auth";
import {OperationTimerError} from "./timer-server";
import {disregardReview,pendingDisregard} from "./disregard-policy";
type Member=NonNullable<Awaited<ReturnType<typeof getOperationMember>>>;
export async function requestDisregard(member:Member,id:string,reason:string){
 if(member.canEdit===false)throw new OperationTimerError("Sem permissão para alterar atividades.",403);
 if(reason.trim().length<5||reason.length>2000)throw new OperationTimerError("Informe uma justificativa de 5 a 2.000 caracteres para a análise do gestor.",400);
 return prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "OperationActivity" WHERE id=${id} AND "organizationId"=${member.organizationId} FOR UPDATE`;
  const activity=await tx.operationActivity.findFirst({where:{id,organizationId:member.organizationId,deletedAt:null},include:{client:{select:{name:true}}}});
  if(!activity)throw new OperationTimerError("Atividade não encontrada.",404);
  if(!canManageOperations(member.role)&&activity.responsibleId!==member.userId)throw new OperationTimerError("Solicite a desconsideração apenas das suas atividades.",403);
  if(["COMPLETED","DISREGARDED"].includes(activity.status))throw new OperationTimerError("Esta atividade já foi encerrada.",409);
  if(pendingDisregard(activity.disregardReview))return {pending:true};
  const [author,managers]=await Promise.all([tx.organizationMember.findFirst({where:{organizationId:member.organizationId,userId:member.userId},select:{id:true}}),tx.organizationMember.findMany({where:{organizationId:member.organizationId,role:{in:["MASTER","ADMIN","MANAGER"]}},select:{id:true}})]);
  if(!author||!managers.length)throw new OperationTimerError("Não há gestor disponível para receber esta solicitação.",409);
  const now=new Date(),requestId=randomUUID();
  const notice=await tx.notice.create({data:{id:"operation-disregard:"+requestId,organizationId:member.organizationId,authorMemberId:author.id,kind:"ALERT",scope:"MEMBERS",priority:"HIGH",title:"Aprovar desconsideração de atividade",body:`${member.user.name||member.user.email} solicitou desconsiderar “${activity.title}” de ${activity.client.name}.\n\nJustificativa: ${reason.trim()}`,recipients:{create:managers.map(manager=>({memberId:manager.id}))}},select:{id:true}});
  const entries=await tx.operationTimeEntry.findMany({where:{activityId:id,endedAt:null},select:{id:true,startedAt:true}});
  for(const entry of entries)await tx.operationTimeEntry.updateMany({where:{id:entry.id,endedAt:null},data:{endedAt:now,seconds:Math.max(0,Math.floor((+now-+entry.startedAt)/1000))}});
  await tx.operationActivity.update({where:{id},data:{status:entries.length||activity.status==="IN_PROGRESS"?"PAUSED":activity.status,disregardReview:{requestId,status:"PENDING",reason:reason.trim(),requestedById:member.userId,requestedAt:now.toISOString(),noticeId:notice.id}}});
  await tx.operationEvent.create({data:{activityId:id,userId:member.userId,type:"STATUS_CHANGED",message:"Desconsideração solicitada; aguardando aprovação do gestor.",metadata:{requestId,reason:reason.trim(),noticeId:notice.id}}});
  return {pending:true};
 });
}
export async function decideDisregard(member:Member,id:string,requestId:string,approve:boolean){
 if(!canManageOperations(member.role)||member.canEdit===false)throw new OperationTimerError("Somente a gestão pode aprovar ou recusar justificativas.",403);
 return prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "OperationActivity" WHERE id=${id} AND "organizationId"=${member.organizationId} FOR UPDATE`;
  const activity=await tx.operationActivity.findFirst({where:{id,organizationId:member.organizationId,deletedAt:null}}),review=disregardReview(activity?.disregardReview);
  if(!activity||!review||review.requestId!==requestId)throw new OperationTimerError("Solicitação não encontrada ou substituída. Atualize os avisos.",409);
  if(review.status!=="PENDING")return {status:review.status};
  if(["COMPLETED","DISREGARDED"].includes(activity.status))throw new OperationTimerError("A atividade foi encerrada durante a análise. Confira o histórico.",409);
  const now=new Date(),status=approve?"APPROVED":"REJECTED";
  await tx.operationActivity.update({where:{id},data:{status:approve?"DISREGARDED":"OPEN",disregardedReason:approve?review.reason:null,disregardReview:{...review,status,decidedById:member.userId,decidedAt:now.toISOString()}}});
  await tx.operationEvent.create({data:{activityId:id,userId:member.userId,type:approve?"DISREGARDED":"STATUS_CHANGED",message:approve?"Gestor aprovou a justificativa e desconsiderou a atividade.":"Gestor recusou a justificativa; atividade devolvida como aberta ao operador.",metadata:{requestId,reason:review.reason}}});
  await tx.notice.updateMany({where:{id:review.noticeId,organizationId:member.organizationId},data:{closedAt:now}});await tx.noticeRecipient.updateMany({where:{noticeId:review.noticeId},data:{viewedAt:now,completedAt:now}});
  return {status};
 });
}
