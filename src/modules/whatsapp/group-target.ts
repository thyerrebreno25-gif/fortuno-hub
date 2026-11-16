import "server-only";
import {prisma} from "@/lib/prisma";
import {resolveWhatsappTicketId} from "./server";
import {canManageGroupInHub} from "./group-management-policy";
import type {currentWhatsAppAccount} from "./account-scope";
export async function groupTarget(id:string,account:Awaited<ReturnType<typeof currentWhatsAppAccount>>,actor:{organizationId:string;userId:string;role:string},permission:{canView?:boolean;canEdit?:boolean;canManage?:boolean}){
 const entry=id.startsWith("directory:")?await prisma.whatsAppDirectoryEntry.findFirst({where:{id:id.slice(10),organizationId:actor.organizationId,connectionId:account.connection!.id,accountPhone:account.connection!.phone!,kind:"GROUP",active:true},select:{externalId:true}}):null;
 if(id.startsWith("directory:")&&!entry)throw new Error("Grupo não encontrado na conta conectada.");
 const ticketId=entry?null:await resolveWhatsappTicketId(id,actor.organizationId);
 const ticket=await prisma.serviceTicket.findFirst({where:{...(entry?{senderEmail:"wa-group:"+entry.externalId}:{id:ticketId!}),...account.where,mergedIntoId:null,isSpam:false},orderBy:{updatedAt:"desc"},select:{id:true,senderEmail:true,recipientEmail:true,assignedToId:true,status:true}});
 if(!entry&&!ticket)throw new Error("Conversa indisponível na conta conectada.");
 if(!canManageGroupInHub(actor.role,permission,actor.userId,ticket||{assignedToId:null,status:"RESOLVED"}))throw new Error("Assuma o chamado ou solicite a alteração a um gestor.");
 const jid=entry?.externalId||ticket?.senderEmail.match(/^wa-group:(\d+(?:-\d+)?@g\.us)$/)?.[1];
 if(!jid||!/^\d+(?:-\d+)?@g\.us$/.test(jid))throw new Error("Este registro não é um grupo.");
 return jid;
}
