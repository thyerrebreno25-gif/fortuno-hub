import {getWhatsAppPermission} from "@/modules/atendimento/auth";
import "server-only";
import {prisma} from "@/lib/prisma";
import {Prisma} from "@/generated/prisma/client";
import {currentWhatsAppAccount,accountMessageWhere} from "./account-scope";
export function whatsappFinancialSource(key:string){const match=/^whatsapp:([a-zA-Z0-9_-]{1,100})$/.exec(key);return match?{messageId:match[1]}:null;}
export async function validateWhatsAppFinancialSource(member:{organizationId:string;userId:string;role:string},clientId:string,key:string,attachmentIds:string[]=[]){
 const source=whatsappFinancialSource(key);if(!source)return false;
 const permission=await getWhatsAppPermission(member.organizationId,member.role);if(!permission.canEdit||member.role==="CLIENT")return false;
 const account=await currentWhatsAppAccount(member.organizationId);
 const message=await prisma.serviceMessage.findFirst({where:{id:source.messageId,direction:{not:"INTERNAL"},...accountMessageWhere(account.connection),ticket:{...account.where,mergedIntoId:null,isSpam:false}},select:{id:true,attachments:{select:{id:true}},ticket:{select:{senderEmail:true}}}});if(!message||attachmentIds.some(id=>!message.attachments?.some(file=>file.id===id)))return false;
 return Boolean(await prisma.serviceTicket.findFirst({where:{...account.where,senderEmail:message.ticket.senderEmail,clientId,assignedToId:member.userId,status:{notIn:["RESOLVED","SPAM"]},mergedIntoId:null,isSpam:false},select:{id:true}}));
}

export async function completeWhatsAppPaymentRequest(key:string,organizationId:string,userId:string,exportId:string){
 const source=whatsappFinancialSource(key);if(!source)return;
 await prisma.$executeRaw(Prisma.sql`UPDATE "WhatsAppPaymentRequest" SET status='CREATED',"checkedAt"=CURRENT_TIMESTAMP,"checkedById"=${userId},"exportId"=${exportId} WHERE "messageId"=${source.messageId} AND "organizationId"=${organizationId}`);
}
