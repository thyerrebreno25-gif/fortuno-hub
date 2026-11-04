import {OpenAIRequestError} from "@/modules/assistant/openai-errors";
import "server-only";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {Prisma} from "@/generated/prisma/client";
import {prisma} from "@/lib/prisma";
import {findMeeting,MeetingError,type MeetingMember} from "./auth";
import {editableMeeting} from "./model";
import {transcribeRecording} from "./recordings";
import {reportFingerprint,reportSource,renderMeetingReport,splitReportText,reportSummarySchema,type ReportSummary} from "./report-model";
import {summarizeMeetingPart} from "./report-ai";
export const publicReportSelect={id:true,status:true,includeRecordings:true,content:true,mode:true,error:true,generatedAt:true,sourceHash:true} satisfies Prisma.MeetingReportSelect;
const include={fathomRecordings:{orderBy:{startsAt:"asc" as const}},participants:{include:{user:{select:{name:true,email:true}}}},actions:{include:{responsible:{select:{name:true,email:true}}},orderBy:{dueAt:"asc" as const}},contributions:{include:{author:{select:{name:true,email:true}}},orderBy:{createdAt:"asc" as const}},recordings:{orderBy:{createdAt:"asc" as const}}} satisfies Prisma.TeamMeetingInclude;
const active=["PENDING","PROCESSING","WAITING_AUDIO"];
const inputSchema=z.object({meetingId:z.string().min(1).max(100),revision:z.number().int().positive(),finish:z.boolean().default(false),generate:z.boolean().default(true),includeRecordings:z.boolean().default(false),force:z.boolean().default(false)});
export async function requestMeetingReport(member:MeetingMember,body:unknown){
 const input=inputSchema.parse(body),meeting=await findMeeting(member,input.meetingId);
 if(!editableMeeting(member,meeting))throw new MeetingError("Somente o organizador ou um gestor pode finalizar a reunião e gerar o relatório.",403);
 if(meeting.status==="CANCELLED")throw new MeetingError("Não é possível finalizar ou gerar relatório de uma reunião cancelada.",409);
 return prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "TeamMeeting" WHERE id=${meeting.id} FOR UPDATE`;
  const current=await tx.teamMeeting.findFirst({where:{id:meeting.id,organizationId:member.organizationId,deletedAt:null}});
  if(!current||current.status==="CANCELLED")throw new MeetingError("A reunião não está disponível.",409);
  if(input.generate&&input.includeRecordings&&!current.fathomEnabled){
   const recordings=await tx.meetingRecording.findMany({where:{meetingId:meeting.id},select:{status:true}});
   if(recordings.some(row=>row.status!=="UPLOADING")&&!process.env.OPENAI_API_KEY?.trim())throw new MeetingError("A transcrição depende da configuração da IA. Você pode gerar o relatório somente com notas e atividades.",503);
  }
  if(input.finish&&current.status!=="COMPLETED"){
   const changed=await tx.teamMeeting.updateMany({where:{id:meeting.id,organizationId:member.organizationId,revision:input.revision,deletedAt:null,status:{not:"CANCELLED"}},data:{status:"COMPLETED",revision:{increment:1}}});
   if(!changed.count)throw new MeetingError("A reunião foi alterada. Atualize a tela antes de finalizar.",409);
   await tx.teamCalendarEvent.updateMany({where:{organizationId:member.organizationId,meetingId:meeting.id,actionItemId:null},data:{status:"COMPLETED",googleSyncStatus:"PENDING",revision:{increment:1}}});
   await tx.auditLog.create({data:{userId:member.userId,action:"COMPLETE_MEETING",entity:"TeamMeeting",entityId:meeting.id,afterData:{status:"COMPLETED",revision:input.revision+1}}});
  }else if(current.status!=="COMPLETED")throw new MeetingError("Finalize a reunião antes de gerar o relatório.",409);
  if(!input.generate)return {report:null,completed:true};
  const existing=await tx.meetingReport.findUnique({where:{meetingId:meeting.id}});
  if(existing&&((active.includes(existing.status)&&!(input.force&&existing.includeRecordings!==input.includeRecordings))||existing.status==="READY"&&!input.force))return {report:{id:existing.id,status:existing.status},completed:true};
  const data={requestedById:member.userId,includeRecordings:input.includeRecordings,generation:randomUUID(),status:"PENDING",error:null,work:existing?.status==="FAILED"&&existing.includeRecordings===input.includeRecordings?(existing.work??Prisma.DbNull):Prisma.DbNull,claimedAt:null,nextRunAt:new Date()};
  const report=await tx.meetingReport.upsert({where:{meetingId:meeting.id},create:{meetingId:meeting.id,...data},update:data,select:{id:true,status:true}});
  await tx.auditLog.create({data:{userId:member.userId,action:"GENERATE_MEETING_REPORT",entity:"TeamMeeting",entityId:meeting.id,afterData:{includeRecordings:input.includeRecordings,generation:data.generation}}});
  return {report,completed:true};
 },{timeout:30000,maxWait:10000});
}
const workSchema=z.object({hash:z.string(),inputs:z.array(z.string()),outputs:z.array(reportSummarySchema),index:z.number().int().nonnegative(),level:z.number().int().nonnegative(),retryCount:z.number().int().nonnegative().default(0)});
export async function processMeetingReport(meetingId:string){
 const report=await prisma.meetingReport.findUnique({where:{meetingId}});if(!report)return;
 const now=new Date(),stale=report.status==="PROCESSING"&&!!report.claimedAt&&report.claimedAt<new Date(Date.now()-15*60000);
 if(!["PENDING","WAITING_AUDIO"].includes(report.status)&&!stale||report.nextRunAt>now)return;
 const claim=await prisma.meetingReport.updateMany({where:{id:report.id,generation:report.generation,status:report.status,claimedAt:report.claimedAt},data:{status:"PROCESSING",claimedAt:now,error:null}});if(!claim.count)return;
 const owned={id:report.id,generation:report.generation,status:"PROCESSING",claimedAt:now};
 try{
  const meeting=await prisma.teamMeeting.findFirst({where:{id:meetingId,deletedAt:null,status:"COMPLETED"},include});
  if(!meeting)throw new Error("A reunião não está mais finalizada ou foi excluída. Nenhum novo relatório foi publicado.");
  if(report.includeRecordings&&meeting.fathomEnabled){
   const records=meeting.fathomRecordings;
   const pending=!records.length||records.some(row=>!row.transcript.trim()||!row.summary.trim());
   const hash=reportFingerprint(meeting,true);
   let content=renderMeetingReport(meeting,null,false).split("\n## Gravações e transcrição")[0];
   for(const recording of records)content+="\n\n## Conteúdo recebido do Fathom · "+recording.title+"\n"+recording.summary+"\n\n### Atividades sugeridas pelo Fathom (não distribuídas no Hub)\n"+(recording.actionItems||"Nenhuma atividade sugerida.");
   content+="\n\nA gravação e a transcrição integral estão na aba Gravações e transcrições. As tarefas oficiais e seus prazos são as registradas no checklist do Hub.";
   const fresh=await prisma.teamMeeting.findFirst({where:{id:meetingId,deletedAt:null,status:"COMPLETED"},include});
   if(!fresh||reportFingerprint(fresh,true)!==hash){await prisma.meetingReport.updateMany({where:owned,data:{status:"PENDING",claimedAt:null,nextRunAt:new Date()}});return;}
   await prisma.meetingReport.updateMany({where:{...owned,meeting:{deletedAt:null,status:"COMPLETED"}},data:{status:pending?"WAITING_AUDIO":"READY",content,sourceHash:hash,mode:"FATHOM",error:pending?"Relatório dos registros do Hub disponível. Aguardando o Fathom disponibilizar resumo e transcrição. Confira a conexão e a captura da reunião no Fathom.":null,generatedAt:new Date(),work:Prisma.DbNull,claimedAt:null,nextRunAt:new Date(Date.now()+60000)}});return;
  }
  if(report.includeRecordings){
   const pending=meeting.recordings.find(row=>row.status!=="UPLOADING"&&(row.status!=="DONE"||!row.transcript.trim()));
   if(pending){
    if(!process.env.OPENAI_API_KEY?.trim())throw new Error("A transcrição depende da configuração da IA.");
    await transcribeRecording(pending.id);
    const updated=await prisma.meetingRecording.findUnique({where:{id:pending.id},select:{status:true,transcript:true,error:true}});
    if(!updated||updated.status==="FAILED"||updated.status==="DONE"&&!updated.transcript.trim())throw new Error(updated?.error || "Não foi possível transcrever uma gravação. Confira a aba Gravações e transcrições e tente novamente.");
    await prisma.meetingReport.updateMany({where:owned,data:{status:updated.status==="DONE"?"PENDING":"WAITING_AUDIO",claimedAt:null,nextRunAt:new Date(Date.now()+1000)}});return;
   }
  }
  const hash=reportFingerprint(meeting,report.includeRecordings);
  let summary:ReportSummary|null=null,mode="BASIC";
  if(report.includeRecordings&&process.env.OPENAI_API_KEY?.trim()){
   mode="AI";const saved=workSchema.safeParse(report.work);
   let work=saved.success&&saved.data.hash===hash?saved.data:{hash,inputs:splitReportText(JSON.stringify(reportSource(meeting,report.includeRecordings),null,2),40000),outputs:[] as ReportSummary[],index:0,level:0,retryCount:0};
   for(let step=0;step<2;step++){
    let output:ReportSummary;
    try{output=await summarizeMeetingPart(work.inputs[work.index],work.level>0);}
    catch(error){
     if(error instanceof OpenAIRequestError&&error.details.kind==="rate_limit"&&work.retryCount<3){
      await prisma.meetingReport.updateMany({where:owned,data:{status:"PENDING",error:error.message,work:{...work,retryCount:work.retryCount+1} as Prisma.InputJsonValue,claimedAt:null,nextRunAt:new Date(Date.now()+Math.max(60,error.details.retryAfterSeconds||60)*1000)}});return;
     }
     if(!report.content){
      const fresh=await prisma.teamMeeting.findFirst({where:{id:meetingId,deletedAt:null,status:"COMPLETED"},include});
      if(!fresh)throw error;
      if(reportFingerprint(fresh,report.includeRecordings)!==hash){await prisma.meetingReport.updateMany({where:owned,data:{status:"PENDING",work:Prisma.DbNull,claimedAt:null,nextRunAt:new Date()}});return;}
      const warning=error instanceof OpenAIRequestError?error.message:"Não foi possível concluir a síntese por IA. Os registros do Hub foram consolidados abaixo.";
      await prisma.meetingReport.updateMany({where:{...owned,meeting:{deletedAt:null,status:"COMPLETED"}},data:{status:"READY",content:renderMeetingReport(meeting,null,report.includeRecordings),sourceHash:hash,mode:"BASIC",error:warning,generatedAt:new Date(),work:Prisma.DbNull,claimedAt:null}});return;
     }
     throw error;
    }
    work={...work,outputs:[...work.outputs,output],index:work.index+1};
    if(work.index===work.inputs.length){
     if(work.inputs.length===1){summary=output;break;}
     if(work.level>=8)throw new Error("A síntese ficou extensa demais. Divida o conteúdo em reuniões menores antes de gerar novamente.");
     work={hash,inputs:splitReportText(JSON.stringify(work.outputs),40000),outputs:[],index:0,level:work.level+1,retryCount:0};
    }
    const saved=await prisma.meetingReport.updateMany({where:owned,data:{work:work as Prisma.InputJsonValue}});if(!saved.count)return;
   }
   if(!summary){await prisma.meetingReport.updateMany({where:owned,data:{status:"PENDING",work:work as Prisma.InputJsonValue,claimedAt:null,nextRunAt:new Date()}});return;}
  }
  const fresh=await prisma.teamMeeting.findFirst({where:{id:meetingId,deletedAt:null,status:"COMPLETED"},include});
  if(!fresh)throw new Error("A reunião foi alterada ou excluída durante a geração.");
  if(reportFingerprint(fresh,report.includeRecordings)!==hash){await prisma.meetingReport.updateMany({where:owned,data:{status:"PENDING",work:Prisma.DbNull,claimedAt:null,nextRunAt:new Date()}});return;}
  await prisma.meetingReport.updateMany({where:{...owned,meeting:{deletedAt:null,status:"COMPLETED"}},data:{status:"READY",content:renderMeetingReport(meeting,summary,report.includeRecordings),sourceHash:hash,mode,generatedAt:new Date(),work:Prisma.DbNull,error:null,claimedAt:null}});
 }catch(error){await prisma.meetingReport.updateMany({where:owned,data:{status:"FAILED",claimedAt:null,error:error instanceof Error?error.message.slice(0,500):"Não foi possível gerar o relatório. Os registros foram preservados."}});}
}
export async function processQueuedMeetingReports(){
 const jobs=await prisma.meetingReport.findMany({where:{nextRunAt:{lte:new Date()},OR:[{status:{in:["PENDING","WAITING_AUDIO"]}},{status:"PROCESSING",claimedAt:{lt:new Date(Date.now()-15*60000)}}]},orderBy:{nextRunAt:"asc"},take:1,select:{meetingId:true}});
 for(const job of jobs)await processMeetingReport(job.meetingId);
}
