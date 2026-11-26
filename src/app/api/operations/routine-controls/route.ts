import {NextResponse} from "next/server";
import {Prisma} from "@/generated/prisma/client";
import {prisma} from "@/lib/prisma";
import {getOperationMember,canManageOperations} from "@/modules/operations/auth";
import {OperationTimerError} from "@/modules/operations/timer-server";
import {inheritedRoutineFamily,reconciliationFamily,reconciliationOwner} from "@/modules/operations/routine-ownership";
import {propagateRoutineOwner} from "@/modules/operations/routine-ownership-server";
import {reassignRoutine} from "@/modules/operations/routine-reassign-server";
import {untouchedRoutineActivity} from "@/modules/operations/routine-edit-plan";
import {operationToday} from "@/modules/operations/activity-deadline";
import {shiftDay} from "@/modules/operations/analytics";
import {generateActivitiesForConfigurationRange} from "@/modules/operations/recurrence";
export const maxDuration=60;
const removal="Cliente com rotinas suspensas";
export async function POST(request:Request){
 try{
  const member=await getOperationMember();if(!member)return NextResponse.json({error:"Sessão inválida."},{status:401});
  if(!canManageOperations(member.role)||member.canEdit===false)return NextResponse.json({error:"Sem permissão para alterar rotinas."},{status:403});
  const body=await request.json() as Record<string,unknown>;
  if(!["synchronize","transfer","suspend","resume","onboarding"].includes(String(body.action)))throw new OperationTimerError("Ação inválida.",400);
  const result=await prisma.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"operations-reset-"+member.organizationId}))`;
   if(body.action==="synchronize"){
    const routines=await tx.operationClientProcess.findMany({where:{active:true,client:{organizationId:member.organizationId}},include:{process:{select:{name:true}}},orderBy:{id:"asc"}});
    let transferred=0;
    for(const clientId of new Set(routines.map(r=>r.clientId)))for(const family of ["payments","receipts"] as const){
     let owner:string|null;try{owner=reconciliationOwner(routines,clientId,family);}catch{continue;}
     if(!owner)continue;
     for(const routine of routines.filter(r=>r.clientId===clientId&&inheritedRoutineFamily(r.process.name)===family&&r.responsibleId!==owner)){
      await tx.operationClientProcess.update({where:{id:routine.id},data:{responsibleId:owner}});
      await tx.$queryRaw`SELECT id FROM "OperationActivity" WHERE "clientProcessId"=${routine.id} AND "organizationId"=${member.organizationId} ORDER BY id FOR UPDATE`;
      transferred+=(await reassignRoutine(tx,member,routine.id,owner)).transferred;
     }
    }
    return {transferred};
   }
   const clientId=typeof body.clientId==="string"?body.clientId:"";
   const client=await tx.client.findFirst({where:{id:clientId,organizationId:member.organizationId},select:{id:true}});if(!client)throw new OperationTimerError("Cliente não encontrado.",404);
   if(body.action==="transfer"){
    const responsibleId=typeof body.responsibleId==="string"?body.responsibleId:"";
    if(!await tx.organizationMember.findFirst({where:{organizationId:member.organizationId,userId:responsibleId,role:{not:"CLIENT"}},select:{id:true}}))throw new OperationTimerError("Responsável inválido.",400);
    const routine=await tx.operationClientProcess.findFirst({where:{id:String(body.routineId||""),clientId,active:true},include:{process:{select:{name:true}}}});
    if(!routine)throw new OperationTimerError("Rotina não encontrada.",404);
    if(routine.updatedAt.toISOString()!==body.expectedUpdatedAt)throw new OperationTimerError("A rotina mudou. Reabra a transferência.",409);
    const family=reconciliationFamily(routine.process.name)||inheritedRoutineFamily(routine.process.name);
    if(family){const name=family==="payments"?"Conciliação de Pagamentos":"Conciliação de Recebimentos";return propagateRoutineOwner(tx,member,clientId,name,responsibleId);}
    await tx.operationClientProcess.update({where:{id:routine.id},data:{responsibleId}});
    await tx.$queryRaw`SELECT id FROM "OperationActivity" WHERE "clientProcessId"=${routine.id} AND "organizationId"=${member.organizationId} ORDER BY id FOR UPDATE`;
    return reassignRoutine(tx,member,routine.id,responsibleId);
   }
   await tx.$executeRaw(Prisma.sql`INSERT INTO "OperationClientRoutineState" ("clientId","organizationId") VALUES (${clientId},${member.organizationId}) ON CONFLICT ("clientId") DO NOTHING`);
   if(body.action==="onboarding"){
    if(typeof body.enabled!=="boolean")throw new OperationTimerError("Estado inválido.",400);
    await tx.$executeRaw(Prisma.sql`UPDATE "OperationClientRoutineState" SET onboarding=${body.enabled},"updatedAt"=CURRENT_TIMESTAMP WHERE "clientId"=${clientId} AND "organizationId"=${member.organizationId}`);
    await tx.auditLog.create({data:{userId:member.userId,action:"ROUTINE_CLIENT_ONBOARDING",entity:"Client",entityId:clientId,afterData:{enabled:body.enabled}}});return {updated:true};
   }
   const suspend=body.action==="suspend",tomorrow=new Date(shiftDay(operationToday(),1)+"T00:00:00Z");
   await tx.$executeRaw(Prisma.sql`UPDATE "OperationClientRoutineState" SET suspended=${suspend},"updatedAt"=CURRENT_TIMESTAMP WHERE "clientId"=${clientId} AND "organizationId"=${member.organizationId}`);
   await tx.$queryRaw`SELECT id FROM "OperationActivity" WHERE "clientId"=${clientId} AND "organizationId"=${member.organizationId} AND "scheduledDate">=${tomorrow} ORDER BY id FOR UPDATE`;
   const scope={clientId,organizationId:member.organizationId,clientProcess:{active:true},scheduledDate:{gte:tomorrow}};
   const rows=await tx.operationActivity.findMany({where:{...scope,...(suspend?{deletedAt:null}:{deletionReason:removal,deletedAt:{not:null}})},include:{timeEntries:true,comments:true,attachments:true,checklistItems:true}});
   const ids=rows.filter(untouchedRoutineActivity).map(r=>r.id);
   const changed=await tx.operationActivity.updateMany({where:{...scope,id:{in:ids}},data:suspend?{deletedAt:new Date(),deletedById:member.userId,deletionReason:removal}:{deletedAt:null,deletedById:null,deletionReason:null}});
   await tx.auditLog.create({data:{userId:member.userId,action:suspend?"ROUTINE_CLIENT_SUSPENDED":"ROUTINE_CLIENT_RESUMED",entity:"Client",entityId:clientId,afterData:{changed:changed.count,activityIds:ids}}});
   return {changed:changed.count};
  },{maxWait:10000,timeout:50000});
  if(body.action==="resume"){
   const routines=await prisma.operationClientProcess.findMany({where:{clientId:String(body.clientId),active:true,client:{organizationId:member.organizationId}},select:{id:true}});
   try{for(const r of routines)await generateActivitiesForConfigurationRange(r.id,new Date(shiftDay(operationToday(),1)+"T12:00:00Z"),new Date(shiftDay(operationToday(),90)+"T12:00:00Z"),member.userId);}catch{return NextResponse.json({...result,warning:"Cliente reativado. Use Gerar próximos 90 dias para concluir a agenda."});}
  }
  return NextResponse.json(result);
 }catch(error){return NextResponse.json({error:error instanceof OperationTimerError?error.message:"Não foi possível atualizar as rotinas. Atualize e tente novamente."},{status:error instanceof OperationTimerError?error.status:500});}
}
