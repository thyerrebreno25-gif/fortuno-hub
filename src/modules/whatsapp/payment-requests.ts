import "server-only";
import {Prisma} from "@/generated/prisma/client";
import {prisma} from "@/lib/prisma";
import {currentWhatsAppAccount} from "./account-scope";
export type PaymentRequestRow={messageId:string;ticketId:string;clientId:string|null;clientName:string|null;senderName:string|null;textBody:string|null;reason:string;status:string;createdAt:Date;ticketStatus:string;assignedToId:string|null;checkedAt:Date|null;attachments:Array<{id:string;name:string;mimeType:string|null}>};
export async function listPaymentRequests(organizationId:string,userId:string,manager:boolean,scope:"PENDING"|"ALL"="PENDING",take=100){
 const account=await currentWhatsAppAccount(organizationId);if(!account.recipient)return [];
 return prisma.$queryRaw<PaymentRequestRow[]>(Prisma.sql`SELECT p."messageId",t.id AS "ticketId",t."clientId",c.name AS "clientName",t."senderName",m."textBody",p.reason,p.status,p."createdAt",t.status AS "ticketStatus",t."assignedToId",p."checkedAt",COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'mimeType',a."mimeType")) FROM "ServiceAttachment" a WHERE a."messageId"=m.id),'[]'::jsonb) AS attachments FROM "WhatsAppPaymentRequest" p JOIN "ServiceMessage" m ON m.id=p."messageId" JOIN "ServiceTicket" t ON t.id=m."ticketId" LEFT JOIN "Client" c ON c.id=t."clientId" AND c."organizationId"=p."organizationId" WHERE p."organizationId"=${organizationId} AND p."accountRecipient"=${account.recipient} AND t."organizationId"=${organizationId} AND t.source='WHATSAPP_API' AND t."recipientEmail"=${account.recipient} AND t."mergedIntoId" IS NULL AND t."isSpam"=false AND (${manager} OR t."assignedToId"=${userId}) AND (${scope}='ALL' OR p.status='PENDING') ORDER BY p."createdAt" DESC LIMIT ${take}`);
}
export async function paymentRequestNotifications(organizationId:string,userId:string,manager:boolean){
 const rows=await listPaymentRequests(organizationId,userId,manager,"PENDING",20);
 return rows.map(row=>({id:`whatsapp-payment-${row.messageId}`,type:"WARNING" as const,title:"Possível solicitação de pagamento",description:row.clientName||row.senderName||"Confira o pedido na conversa",href:`/whatsapp?ticket=${encodeURIComponent(row.ticketId)}&payment=${encodeURIComponent(row.messageId)}`,createdAt:row.createdAt.toISOString(),popup:true,priority:1}));
}
