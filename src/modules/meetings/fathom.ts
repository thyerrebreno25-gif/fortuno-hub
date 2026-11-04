import "server-only";
import {randomUUID} from "node:crypto";
import {prisma} from "@/lib/prisma";
import {encryptIntegrationSecret,decryptIntegrationSecret} from "@/modules/purchase-invoices/server/crypto";
import {MeetingError,type MeetingMember} from "./auth";
import {fathomMeetingSchema,fathomPlaybackUrl,fathomContent,matchesFathomMeeting} from "./fathom-model";
import {z} from "zod";
const base="https://api.fathom.ai/external/v1";
export async function fathomRequest(key:string,path:string,init:RequestInit={}){
 const response=await fetch(base+path,{...init,headers:{"X-Api-Key":key,"Content-Type":"application/json"},cache:"no-store",signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new MeetingError(response.status===401?"A chave do Fathom está inválida ou foi revogada.":response.status===403?"O Fathom não permite acesso a esse conteúdo com a conta conectada.":response.status===429?"O Fathom limitou as consultas. Aguarde alguns minutos.":"O Fathom não concluiu a consulta. Tente novamente.",response.status===401||response.status===403?400:503);
 return response.status===204?null:response.json();
}
export const publicFathomConnection={id:true,enabled:true,lastSyncAt:true,error:true,createdAt:true};
export async function connectFathom(member:MeetingMember,body:unknown){
 const {apiKey}=z.object({apiKey:z.string().trim().min(10).max(2000)}).parse(body);
 const origin=new URL(process.env.NEXT_PUBLIC_APP_URL||"https://app.hubsuporte.shop").origin;
 if(!origin.startsWith("https://"))throw new MeetingError("Configure a URL HTTPS do Hub antes de conectar.",503);
 // Validate credentials without importing unrelated recordings.
 const probe=await fathomRequest(apiKey,"/meetings");
 if(!Array.isArray(probe?.items))throw new MeetingError("O Fathom retornou uma resposta inválida.",502);
 const previous=await prisma.fathomConnection.findUnique({where:{organizationId_userId:{organizationId:member.organizationId,userId:member.userId}}});
 // A new callback ID prevents old webhooks from using a replacement credential.
 const id=randomUUID();
 const encryptedApiKey=encryptIntegrationSecret(apiKey);
 const hook=await fathomRequest(apiKey,"/webhooks",{method:"POST",body:JSON.stringify({destination_url:origin+"/api/meetings/fathom/webhook/"+id,include_transcript:true,include_summary:true,include_action_items:true,triggered_for:["my_recordings"]})});
 const parsed=z.object({id:z.string().min(1),secret:z.string().startsWith("whsec_")}).safeParse(hook);
 if(!parsed.success)throw new MeetingError("O Fathom não confirmou o recebimento automático. Confira a configuração do webhook.",502);
 try{
  await prisma.$transaction(async tx=>{
   // Serialize replacement and avoid two concurrent active subscriptions.
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${member.organizationId+":"+member.userId+":fathom"}))`;
   const current=await tx.fathomConnection.findUnique({where:{organizationId_userId:{organizationId:member.organizationId,userId:member.userId}}});
   if((current?.callbackId||null)!==(previous?.callbackId||null))throw new MeetingError("A conexão foi alterada em outra tela. Atualize antes de tentar novamente.",409);
   // Keep the connection row and existing recordings; only the callback generation changes.
   const data={encryptedApiKey,encryptedWebhookSecret:encryptIntegrationSecret(parsed.data.secret),webhookId:parsed.data.id,callbackId:id,enabled:true,error:null,syncCursor:null,syncClaimedAt:null,syncFrom:new Date(Date.now()-30*86400000)};
   await tx.fathomConnection.upsert({where:{organizationId_userId:{organizationId:member.organizationId,userId:member.userId}},create:{organizationId:member.organizationId,userId:member.userId,...data},update:data});
  },{timeout:30000});
 }catch(error){await fathomRequest(apiKey,"/webhooks/"+encodeURIComponent(parsed.data.id),{method:"DELETE"}).catch(()=>undefined);throw error;}
 if(previous)await fathomRequest(decryptIntegrationSecret(previous.encryptedApiKey),"/webhooks/"+encodeURIComponent(previous.webhookId),{method:"DELETE"}).catch(()=>undefined);
}
export async function importFathomMeeting(connectionId:string,payload:unknown){
 const recording=fathomMeetingSchema.parse(payload),playbackUrl=fathomPlaybackUrl(recording.url);
 if(!playbackUrl||!Number.isFinite(Date.parse(recording.recording_start_time)))return {imported:false};
 const connection=await prisma.fathomConnection.findFirst({where:{id:connectionId,enabled:true}});if(!connection)return {imported:false};
 const start=new Date(recording.scheduled_start_time||recording.recording_start_time);if(!Number.isFinite(start.getTime()))return {imported:false};
 return prisma.$transaction(async tx=>{
  const candidates=await tx.teamMeeting.findMany({where:{organizationId:connection.organizationId,deletedAt:null,fathomEnabled:true,status:{not:"CANCELLED"},startsAt:{gte:new Date(start.getTime()-24*3600000),lte:new Date(start.getTime()+24*3600000)},OR:[{createdById:connection.userId},{participants:{some:{userId:connection.userId}}}]},select:{id:true,meetLink:true,location:true,startsAt:true,endsAt:true}});
  const matches=candidates.filter(meeting=>matchesFathomMeeting(meeting,recording));
  if(matches.length!==1)return {imported:false};
  const meeting=matches[0];
  await tx.$queryRaw`SELECT id FROM "TeamMeeting" WHERE id=${meeting.id} FOR UPDATE`;
  const current=await tx.teamMeeting.findFirst({where:{id:meeting.id,organizationId:connection.organizationId,deletedAt:null,fathomEnabled:true,status:{not:"CANCELLED"},OR:[{createdById:connection.userId},{participants:{some:{userId:connection.userId}}}]}});
  if(!current||!matchesFathomMeeting(current,recording))return {imported:false};
  const data={meetingId:meeting.id,title:recording.title,playbackUrl,startsAt:new Date(recording.recording_start_time),...fathomContent(recording)};
  await tx.fathomRecording.upsert({where:{connectionId_recordingId:{connectionId,recordingId:recording.recording_id}},create:{connectionId,recordingId:recording.recording_id,...data},update:{...data,...(!data.transcript?{transcript:undefined}:{}),...(!data.summary?{summary:undefined}:{}),...(!data.actionItems?{actionItems:undefined}:{})}});
  await tx.meetingReport.updateMany({where:{meetingId:meeting.id,status:"WAITING_AUDIO"},data:{status:"PENDING",nextRunAt:new Date(),claimedAt:null}});
  return {imported:true,meetingId:meeting.id};
 },{timeout:30000});
}
const pageSchema=z.object({items:z.array(fathomMeetingSchema).max(100),next_cursor:z.string().nullable()});
export async function syncFathomConnection(id:string){
 const connection=await prisma.fathomConnection.findFirst({where:{id,enabled:true}});if(!connection)return;
 const now=new Date();if(connection.syncClaimedAt&&connection.syncClaimedAt>new Date(Date.now()-10*60000))return;
 const claim=await prisma.fathomConnection.updateMany({where:{id,enabled:true,updatedAt:connection.updatedAt,syncClaimedAt:connection.syncClaimedAt},data:{syncClaimedAt:now}});if(!claim.count)return;
 const owned={id,enabled:true,callbackId:connection.callbackId,syncClaimedAt:now};
 try{
  const key=decryptIntegrationSecret(connection.encryptedApiKey);let cursor=connection.syncCursor;
  for(let page=0;page<2;page++){
   const query=new URLSearchParams({created_after:connection.syncFrom.toISOString(),include_summary:"true",include_transcript:"true",include_action_items:"true"});if(cursor)query.set("cursor",cursor);
   const data=pageSchema.parse(await fathomRequest(key,"/meetings?"+query));
   for(const recording of data.items)await importFathomMeeting(id,recording);
   cursor=data.next_cursor;
   const saved=await prisma.fathomConnection.updateMany({where:owned,data:{syncCursor:cursor,error:null,...(!cursor?{lastSyncAt:now,syncFrom:new Date(now.getTime()-86400000)}:{})}});if(!saved.count)return;
   if(!cursor)break;
  }
  await prisma.fathomConnection.updateMany({where:owned,data:{syncClaimedAt:null}});
 }catch(error){await prisma.fathomConnection.updateMany({where:owned,data:{syncClaimedAt:null,error:error instanceof MeetingError?error.message:"Não foi possível sincronizar o Fathom. Tente novamente."}});}
}
export async function syncConnectedFathom(){
 const connections=await prisma.fathomConnection.findMany({where:{enabled:true},orderBy:{lastSyncAt:{sort:"asc",nulls:"first"}},take:4,select:{id:true}});
 for(const connection of connections)await syncFathomConnection(connection.id);
}
export async function fathomDownload(recordingId:string){
 const recording=await prisma.fathomRecording.findUniqueOrThrow({where:{id:recordingId},include:{connection:true}});
 if(!recording.connection.enabled)throw new MeetingError("Reconecte o Fathom para solicitar o arquivo.",409);
 const key=decryptIntegrationSecret(recording.connection.encryptedApiKey);
 let data=recording.downloadId?await fathomRequest(key,"/recordings/"+recording.recordingId+"/downloads/"+encodeURIComponent(recording.downloadId)):null;
 if(!data||["expired","failed"].includes(data.status)){
  data=await fathomRequest(key,"/recordings/"+recording.recordingId+"/download",{method:"POST",body:"{}"});
  if(typeof data?.download_id==="string")await prisma.fathomRecording.update({where:{id:recordingId},data:{downloadId:data.download_id}});
 }
 if(data?.status==="completed"){
  const file=data.video||data.audio;const url=new URL(file?.url||"");
  if(url.protocol!=="https:"||url.username||url.password)throw new MeetingError("O Fathom retornou um endereço de gravação inválido.",502);
  return {status:"completed",url:url.href};
 }
 return {status:"processing"};
}
