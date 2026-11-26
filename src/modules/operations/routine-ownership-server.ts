import "server-only";
import type {Prisma} from "@/generated/prisma/client";
import {inheritedRoutineFamily,reconciliationFamily,reconciliationOwner} from "./routine-ownership";
import {OperationTimerError} from "./timer-server";
import {reassignRoutine} from "./routine-reassign-server";
import type {getOperationMember} from "./auth";
type Member=NonNullable<Awaited<ReturnType<typeof getOperationMember>>>;
export async function inheritedOwner(tx:Prisma.TransactionClient,clientId:string,name:string,required=false){
 const family=inheritedRoutineFamily(name);if(!family)return null;
 const routines=await tx.operationClientProcess.findMany({where:{clientId,active:true},include:{process:{select:{name:true}}}});
 try{const owner=reconciliationOwner(routines,clientId,family);if(!owner&&required)throw new OperationTimerError("Configure primeiro o responsável da conciliação deste cliente.",409);return owner;}catch(error){throw new OperationTimerError((error as Error).message,409);}
}
export async function propagateRoutineOwner(tx:Prisma.TransactionClient,member:Member,clientId:string,name:string,responsibleId:string|null){
 const family=reconciliationFamily(name);if(!family)return {transferred:0,pausedTimers:0};
 const routines=await tx.operationClientProcess.findMany({where:{clientId,active:true,client:{organizationId:member.organizationId}},include:{process:{select:{name:true}}},orderBy:{id:"asc"}});
 let transferred=0,pausedTimers=0;
 for(const routine of routines){if(reconciliationFamily(routine.process.name)!==family&&inheritedRoutineFamily(routine.process.name)!==family)continue;
  await tx.operationClientProcess.update({where:{id:routine.id},data:{responsibleId}});
  await tx.$queryRaw`SELECT id FROM "OperationActivity" WHERE "clientProcessId"=${routine.id} AND "organizationId"=${member.organizationId} ORDER BY id FOR UPDATE`;
  const result=await reassignRoutine(tx,member,routine.id,responsibleId);transferred+=result.transferred;pausedTimers+=result.pausedTimers;
 }
 return {transferred,pausedTimers};
}
