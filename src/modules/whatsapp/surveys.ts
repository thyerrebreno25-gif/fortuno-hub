import "server-only";
import {createHash,randomBytes} from "node:crypto";
import {prisma} from "@/lib/prisma";
import {Prisma} from "@/generated/prisma/client";
import {currentWhatsAppAccount} from "./account-scope";
import {getWhatsappTicket} from "./server";
import {outgoingContext} from "./outgoing-context";
import {object} from "./uazapi";
import {whatsappConnection,sendUazapiText} from "./uazapi-server";
import {isSurveyCoolingDown,nextSurveyBusinessTime} from "./survey-core";
export const surveyTokenHash=(token:string)=>createHash("sha256").update(token).digest("hex");
const coolStatuses=["PENDING","SENDING","SENT","ANSWERED","DECLINED","UNKNOWN","EXPIRED"];
export async function scheduleSurveyForTicket(ticketId:string,organizationId:string,now=new Date()) {
  const policy=await prisma.whatsAppSurveyPolicy.findUnique({where:{organizationId}});
  if(!policy?.enabled||!policy.activatedAt)return null;
  const account=await currentWhatsAppAccount(organizationId);
  if(!account.recipient)return null;
  const ticket=await prisma.serviceTicket.findFirst({where:{...account.where,id:ticketId,status:"RESOLVED",mergedIntoId:null,isSpam:false,client:{active:true},resolvedAt:{gte:policy.activatedAt},firstResponseAt:{not:null}},include:{client:{select:{id:true,name:true}},assignedTo:{select:{id:true,name:true,email:true}}}});
  if(!ticket?.client||!ticket.assignedTo||!ticket.resolvedAt)return null;
  return prisma.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"survey:"+organizationId+":"+ticket.clientId}))`;
    const [optOut,previous]=await Promise.all([
      tx.whatsAppSurveyClientState.findUnique({where:{organizationId_clientId:{organizationId,clientId:ticket.client!.id}}}),
      tx.whatsAppSurvey.findFirst({where:{organizationId,clientId:ticket.client!.id,status:{in:coolStatuses}},orderBy:{createdAt:"desc"}}),
    ]);
    if(optOut?.optedOutAt||isSurveyCoolingDown(previous,policy.cadenceDays,now))return null;
    if(await tx.whatsAppSurvey.findFirst({where:{organizationId,ticketId:ticket.id,createdAt:{gte:ticket.resolvedAt!}},select:{id:true}}))return null;
    return tx.whatsAppSurvey.create({data:{organizationId,clientId:ticket.client!.id,clientName:ticket.client!.name,operatorId:ticket.assignedTo!.id,operatorName:ticket.assignedTo!.name||ticket.assignedTo!.email,ticketId:ticket.id,accountRecipient:account.recipient!,destination:ticket.senderEmail,scheduledAt:nextSurveyBusinessTime(new Date(Math.max(now.getTime(),ticket.resolvedAt!.getTime()+policy.delayMinutes*60000)))}});
  });
}
async function dispatchSurvey(id:string,now=new Date()) {
  const original=await prisma.whatsAppSurvey.findUnique({where:{id}});
  if(!original||original.status!=="PENDING")return;
  const policy=await prisma.whatsAppSurveyPolicy.findUnique({where:{organizationId:original.organizationId}});
  const account=await currentWhatsAppAccount(original.organizationId);
  const ticket=await getWhatsappTicket(original.ticketId,original.organizationId,{});
  const cancel=async(error:string)=>{await prisma.whatsAppSurvey.updateMany({where:{id,status:"PENDING"},data:{status:"CANCELLED",error}});};
  if(!policy?.enabled||account.recipient!==original.accountRecipient||!ticket||ticket.status!=="RESOLVED"||ticket.clientId!==original.clientId||!ticket.resolvedAt){await cancel("Envio cancelado: configuração, conexão ou atendimento alterados.");return;}
  if(original.createdAt.getTime()<now.getTime()-3*86400000){await cancel("Agendamento antigo. Aguarde uma nova finalização elegível.");return;}
  const newTime=nextSurveyBusinessTime(now);
  if(newTime.getTime()>now.getTime()){await prisma.whatsAppSurvey.updateMany({where:{id,status:"PENDING"},data:{scheduledAt:newTime}});return;}
  const [optOut,reopened,client]=await Promise.all([
    prisma.whatsAppSurveyClientState.findUnique({where:{organizationId_clientId:{organizationId:original.organizationId,clientId:original.clientId}}}),
    prisma.serviceTicket.findFirst({where:{...account.where,clientId:original.clientId,mergedIntoId:null,isSpam:false,status:{notIn:["RESOLVED","SPAM"]},lastMessageAt:{gt:ticket.resolvedAt}},select:{id:true}}),
    prisma.client.findFirst({where:{id:original.clientId,organizationId:original.organizationId,active:true},select:{id:true}}),
  ]);
  if(optOut?.optedOutAt||reopened||!client){await cancel("Cliente sem elegibilidade, com novo atendimento ou que recusou novas pesquisas.");return;}
  const token=randomBytes(32).toString("base64url"),expiresAt=new Date(now.getTime()+7*86400000);
  const claimed=await prisma.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"survey:"+original.organizationId+":"+original.clientId}))`;
    const currentPolicy=await tx.whatsAppSurveyPolicy.findUnique({where:{organizationId:original.organizationId}});
    const stopped=await tx.whatsAppSurveyClientState.findUnique({where:{organizationId_clientId:{organizationId:original.organizationId,clientId:original.clientId}}});
    if(!currentPolicy?.enabled||stopped?.optedOutAt)return false;
    const previous=await tx.whatsAppSurvey.findFirst({where:{organizationId:original.organizationId,clientId:original.clientId,id:{not:id},status:{in:coolStatuses},sentAt:{gte:new Date(now.getTime()-currentPolicy.cadenceDays*86400000)}},select:{id:true}});
    if(previous){await tx.whatsAppSurvey.updateMany({where:{id,status:"PENDING"},data:{status:"CANCELLED",error:"Intervalo mínimo entre pesquisas ainda não atingido."}});return false;}
    return (await tx.whatsAppSurvey.updateMany({where:{id,status:"PENDING",scheduledAt:{lte:now}},data:{status:"SENDING",sentAt:now,expiresAt,tokenHash:surveyTokenHash(token)}})).count===1;
  });
  if(!claimed)return;
  let externalMessageId:string|null=null;
  try {
    const connection=await whatsappConnection(original.organizationId);
    const latestInbound=[...ticket.messages].reverse().find(m=>m.direction==="INBOUND");
    const context=outgoingContext(ticket.recipientEmail,ticket.senderEmail,connection,object(latestInbound?.providerMetadata));
    const body=policy.message.replace("{{link}}","https://app.hubsuporte.shop/satisfacao/"+token);
    const sent=await sendUazapiText({organizationId:original.organizationId,accountRecipient:original.accountRecipient,body,...context});externalMessageId=sent.messageId;
    await prisma.$transaction(async tx=>{
      await tx.serviceMessage.upsert({where:{ticketId_externalMessageId:{ticketId:ticket.id,externalMessageId:sent.messageId}},create:{ticketId:ticket.id,direction:"OUTBOUND",externalMessageId:sent.messageId,fromName:"Pesquisa de satisfação",fromEmail:"survey@fortuno.internal",toEmails:[ticket.senderEmail],textBody:body,receivedAt:now,deliveryStatus:"accepted",providerMetadata:{provider:"UAZAPI",type:"WHATSAPP_SURVEY",surveyId:id,accountPhone:sent.accountPhone,connectionId:sent.connectionId,instanceId:sent.instanceId}},update:{providerMetadata:{provider:"UAZAPI",type:"WHATSAPP_SURVEY",surveyId:id,accountPhone:sent.accountPhone,connectionId:sent.connectionId,instanceId:sent.instanceId}}});
      await tx.serviceTicket.update({where:{id:ticket.id},data:{updatedAt:now}});
      await tx.serviceTicketHistory.create({data:{ticketId:ticket.id,type:"WHATSAPP_SURVEY_SENT",message:"Pesquisa periódica de satisfação enviada.",metadata:{surveyId:id}}});
      await tx.whatsAppSurvey.updateMany({where:{id,status:"SENDING"},data:{status:"SENT",externalMessageId:sent.messageId,error:null}});
    });
  } catch {
    // Never retry an uncertain send: the provider may already have delivered the invitation.
    await prisma.whatsAppSurvey.updateMany({where:{id,status:"SENDING"},data:{status:"UNKNOWN",externalMessageId,error:"Envio sem confirmação. Não será repetido automaticamente."}});
  }
}
export async function processWhatsAppSurveys(now=new Date()) {
  await prisma.whatsAppSurvey.updateMany({where:{status:{in:["SENT","SENDING","UNKNOWN"]},expiresAt:{lt:now}},data:{status:"EXPIRED"}});
  const policies=await prisma.whatsAppSurveyPolicy.findMany({where:{enabled:true},take:20});
  for(const policy of policies){
    if(!policy.activatedAt)continue;
    const account=await currentWhatsAppAccount(policy.organizationId);if(!account.recipient)continue;
    const recent=await prisma.$queryRaw<Array<{id:string}>>(Prisma.sql`SELECT t.id FROM "ServiceTicket" t WHERE t."organizationId"=${policy.organizationId} AND t.source='WHATSAPP_API' AND t."recipientEmail"=${account.recipient} AND t.status::text='RESOLVED' AND t."mergedIntoId" IS NULL AND t."isSpam"=false AND t."clientId" IS NOT NULL AND t."firstResponseAt" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "WhatsAppOperationStart" b WHERE b."organizationId"=t."organizationId" AND b."accountRecipient"=t."recipientEmail" AND t."receivedAt"<b."startedAt") AND t."resolvedAt">=${new Date(Math.max(policy.activatedAt.getTime(),now.getTime()-3*86400000))} AND NOT EXISTS(SELECT 1 FROM "WhatsAppSurvey" s WHERE s."organizationId"=t."organizationId" AND s."ticketId"=t.id AND s."createdAt">=t."resolvedAt") AND NOT EXISTS(SELECT 1 FROM "WhatsAppSurveyClientState" p WHERE p."organizationId"=t."organizationId" AND p."clientId"=t."clientId" AND p."optedOutAt" IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM "WhatsAppSurvey" s WHERE s."organizationId"=t."organizationId" AND s."clientId"=t."clientId" AND (s.status IN ('PENDING','SENDING') OR (s.status IN ('SENT','ANSWERED','DECLINED','UNKNOWN','EXPIRED') AND s."sentAt">=${new Date(now.getTime()-policy.cadenceDays*86400000)}))) ORDER BY t."resolvedAt" DESC LIMIT 25`);
    for(const ticket of recent)await scheduleSurveyForTicket(ticket.id,policy.organizationId,now);
  }
  const due=await prisma.whatsAppSurvey.findMany({where:{status:"PENDING",scheduledAt:{lte:now}},orderBy:{scheduledAt:"asc"},take:5,select:{id:true}});
  for(const item of due)await dispatchSurvey(item.id,now);
}
