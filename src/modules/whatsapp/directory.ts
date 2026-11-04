import "server-only";
import {randomUUID} from "node:crypto";
import {prisma} from "@/lib/prisma";
import {Prisma} from "@/generated/prisma/client";
import {decryptIntegrationSecret} from "@/modules/purchase-invoices/server/crypto";
import {object,uazapiRequest} from "./uazapi";
import {CURRENT_DIRECTORY_PREFIX,directoryPage} from "./directory-core";
import type {whatsappConnection} from "./uazapi-server";
type Connection=NonNullable<Awaited<ReturnType<typeof whatsappConnection>>>;
export async function scheduleDirectorySync(connection:Connection, force=false) {
 if(connection.status!=="CONNECTED" || !connection.phone || connection.expiresAt && connection.expiresAt < new Date()) return null;
 return prisma.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"directory:"+connection.id}))`;
  const where={connectionId_accountPhone:{connectionId:connection.id,accountPhone:connection.phone!}};
  const existing=await tx.whatsAppDirectorySync.findUnique({where});
  if(existing && existing.instanceId===connection.instanceId && existing.generation.startsWith(CURRENT_DIRECTORY_PREFIX)) {
   if(["PENDING","RUNNING"].includes(existing.status) || existing.status === "FAILED" && existing.attempts < 5) return existing;
   if(!force && existing.nextRunAt > new Date()) return existing;
  }
  const data={organizationId:connection.organizationId,connectionId:connection.id,accountPhone:connection.phone!,instanceId:connection.instanceId,status:"PENDING",phase:"CONTACTS",offset:0,generation:CURRENT_DIRECTORY_PREFIX+randomUUID(),attempts:0,lastError:null,claimedAt:null,nextRunAt:new Date(),completedAt:null};
  return tx.whatsAppDirectorySync.upsert({where,create:data,update:data});
 });
}
async function directoryBatch(connectionId?:string) {
 const jobs=await prisma.whatsAppDirectorySync.findMany({where:{...(connectionId?{connectionId}:{}),nextRunAt:{lte:new Date()},OR:[{status:{in:["PENDING","FAILED"]},attempts:{lt:5}},{status:"RUNNING",claimedAt:{lt:new Date(Date.now()-300000)}}]},take:4,orderBy:{nextRunAt:"asc"}});
 for(const job of jobs){
  const claimedAt=new Date();
  const claim=await prisma.whatsAppDirectorySync.updateMany({where:{id:job.id,generation:job.generation,status:job.status,claimedAt:job.claimedAt},data:{status:"RUNNING",claimedAt}});
  if(!claim.count)continue;
  try{
   const connection=await prisma.whatsAppConnection.findUnique({where:{id:job.connectionId}});
   if(!connection || connection.instanceId!==job.instanceId || connection.phone!==job.accountPhone || connection.organizationId!==job.organizationId){await prisma.whatsAppDirectorySync.updateMany({where:{id:job.id,generation:job.generation,claimedAt},data:{status:"CANCELLED"}});continue;}
   if(connection.status!=="CONNECTED" || connection.expiresAt && connection.expiresAt < new Date()){await prisma.whatsAppDirectorySync.updateMany({where:{id:job.id,generation:job.generation,claimedAt},data:{status:"PENDING",nextRunAt:new Date(Date.now()+60000)}});continue;}
   const token=decryptIntegrationSecret(connection.tokenEncrypted), kind=job.phase==="GROUPS"?"GROUP":"CONTACT";
   let page;
   try{
    const body=await uazapiRequest(connection.serverUrl,token,kind==="GROUP"?"/group/list":"/contacts/list",{limit:200,offset:job.offset,...(kind==="GROUP"?{noParticipants:true,force:job.offset===0}:{contactScope:"address_book"})});
    page=directoryPage(body,kind,job.offset);
   }catch(error){
    // Older paid servers may expose only the official legacy GET collection routes.
    if(job.offset!==0 || ![404,405].includes(Number(object(error).status)))throw error;
    const body=await uazapiRequest(connection.serverUrl,token,kind==="GROUP"?"/group/list?noParticipants=true":"/contacts?contactScope=address_book");
    page=directoryPage(body,kind,0,true);
   }
   await prisma.$transaction(async tx=>{
    const locked=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM "WhatsAppDirectorySync" WHERE id=${job.id} AND generation=${job.generation} AND "claimedAt"=${claimedAt} AND status='RUNNING' FOR UPDATE`;
    if(!locked.length)return;
    const current=await tx.whatsAppConnection.findFirst({where:{id:job.connectionId,organizationId:job.organizationId,instanceId:job.instanceId,phone:job.accountPhone,status:"CONNECTED"},select:{id:true}});
    if(!current){await tx.whatsAppDirectorySync.update({where:{id:job.id},data:{status:"CANCELLED"}});return;}
    if(page.entries.length) await tx.$executeRaw(Prisma.sql`INSERT INTO "WhatsAppDirectoryEntry" (id,"organizationId","connectionId","accountPhone","externalId",kind,"displayName",generation,active,"updatedAt") VALUES ${Prisma.join(page.entries.map(entry=>Prisma.sql`(${randomUUID()},${job.organizationId},${job.connectionId},${job.accountPhone},${entry.externalId},${entry.kind},${entry.displayName},${job.generation},true,NOW())`))} ON CONFLICT ("connectionId","accountPhone","externalId") DO UPDATE SET "displayName"=EXCLUDED."displayName",generation=EXCLUDED.generation,active=true,"updatedAt"=NOW()`);
    if(!page.hasMore) await tx.whatsAppDirectoryEntry.updateMany({where:{organizationId:job.organizationId,connectionId:job.connectionId,accountPhone:job.accountPhone,kind,generation:{not:job.generation}},data:{active:false}});
    const completed=!page.hasMore && kind==="GROUP";
    await tx.whatsAppDirectorySync.update({where:{id:job.id},data:{status:completed?"COMPLETED":"PENDING",phase:!page.hasMore?"GROUPS":job.phase,offset:page.hasMore?page.nextOffset:0,attempts:0,lastError:null,claimedAt:null,nextRunAt:new Date(Date.now()+(completed?900000:0)),...(completed?{completedAt:new Date()}:{})}});
   },{timeout:15000});
  }catch{
   await prisma.whatsAppDirectorySync.updateMany({where:{id:job.id,generation:job.generation,status:"RUNNING",claimedAt},data:{status:"FAILED",attempts:{increment:1},claimedAt:null,lastError:"Não foi possível concluir a consulta da agenda. Os contatos já sincronizados foram preservados.",nextRunAt:new Date(Date.now()+Math.min(900000,60000*2**job.attempts))}});
  }
 }
 return jobs.length;
}
export async function processDirectorySync(connectionId?:string) {
 const deadline=Date.now()+60000;
 for(let page=0;page<4&&Date.now()<deadline;page++)if(!await directoryBatch(connectionId))break;
}
export async function scheduleConnectedDirectories(){
 const connections=await prisma.whatsAppConnection.findMany({where:{status:"CONNECTED",OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]},take:20});
 for(const connection of connections)await scheduleDirectorySync(connection);
}
