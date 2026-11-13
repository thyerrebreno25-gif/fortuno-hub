import "server-only";
import {prisma} from "@/lib/prisma";
import {getWhatsAppPermission} from "@/modules/atendimento/auth";
import {accountMessageWhere,currentWhatsAppAccount} from "./account-scope";
import {whatsappFinancialSource} from "./payment-financial-source";
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
type Batch={id:string;module:string;metadata:unknown;lines:Array<{metadata:unknown}>};
export async function whatsappFinancialDocuments(member:{organizationId:string;role:string},batches:Batch[]){
 const result:Record<string,Array<{name:string;url:string}>>={};
 const sources=batches.filter(batch=>batch.module==="WHATSAPP").map(batch=>({batch,messageId:whatsappFinancialSource(String(record(batch.metadata).originalSourceKey||""))?.messageId})).filter(source=>source.messageId);
 if(!sources.length)return result;
 const permission=await getWhatsAppPermission(member.organizationId,member.role);if(!permission.canView||member.role==="CLIENT")return result;
 const account=await currentWhatsAppAccount(member.organizationId);
 const messages=await prisma.serviceMessage.findMany({where:{id:{in:sources.map(source=>source.messageId!)},...accountMessageWhere(account.connection),ticket:{...account.where}},select:{id:true,ticketId:true,attachments:{select:{id:true,name:true}}}});
 for(const source of sources){const message=messages.find(message=>message.id===source.messageId);if(!message)continue;const ids=new Set(source.batch.lines.flatMap(line=>{const value=record(record(line.metadata).source).whatsappAttachmentIds;return Array.isArray(value)?value.filter((id):id is string=>typeof id==="string"):[];}));result[source.batch.id]=message.attachments.filter(file=>ids.has(file.id)).map(file=>({name:file.name,url:`/api/whatsapp/${encodeURIComponent(message.ticketId)}/attachments/${encodeURIComponent(file.id)}`}));}
 return result;
}
