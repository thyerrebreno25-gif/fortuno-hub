import "server-only";
import {Prisma} from "@/generated/prisma/client";
import {prisma} from "@/lib/prisma";
import {currentWhatsAppAccount} from "./account-scope";

export type ConversationMessage={id:string;sourceTicketId?:string;direction:"INBOUND"|"OUTBOUND"|"INTERNAL";fromName:string|null;textBody:string|null;receivedAt:string;deliveryStatus:string|null;reaction?:{emoji:string;name:string}|null;customerReactions?:Array<{emoji:string;name:string}>;attachments:Array<{id:string;name:string;mimeType:string|null;size:number|null}>};
type Person={id:string;name:string|null;email:string};
export type ConversationSnapshot={
  id:string;subject:string;senderName:string|null;senderEmail:string;source:string;snippet:string|null;status:string;
  routingArea:string;routingReason:string|null;assignedAt:string|null;receivedAt:string;resolvedAt:string|null;
  firstResponseAt:string|null;lastMessageAt:string;updatedAt:string;
  client:{id:string;name:string;document:string|null;contaAzulConnection:{status:string;active:boolean;externalTenantName:string|null}|null}|null;
  assignedTo:Person|null;messages:ConversationMessage[];history:never[];hasOlderMessages:boolean;previousTicketCount?:number;
};
export class ConversationCursorError extends Error {}
type Account=Awaited<ReturnType<typeof currentWhatsAppAccount>>;
export async function readWhatsAppConversation(id:string,organizationId:string,beforeId?:string,knownAccount?:Account){
  const account=knownAccount||await currentWhatsAppAccount(organizationId);
  if(!account.recipient||!account.connection?.phone)return null;
  const phone=account.connection.phone,recipient=account.recipient;
  // One bounded database snapshot. Provider payloads, HTML, audit history and
  // attachment storage metadata never travel through this screen's read path.
  const rows=await prisma.$queryRaw<Array<{payload:ConversationSnapshot;cursorValid:boolean}>>(Prisma.sql`
    WITH RECURSIVE aliases AS (
      SELECT t.id,t."mergedIntoId",0 AS depth,ARRAY[t.id] AS path FROM "ServiceTicket" t
      WHERE t.id=${id} AND t."organizationId"=${organizationId} AND t.source='WHATSAPP_API' AND t."recipientEmail"=${recipient}
      UNION ALL
      SELECT t.id,t."mergedIntoId",a.depth+1,a.path||t.id FROM "ServiceTicket" t JOIN aliases a ON t.id=a."mergedIntoId"
      WHERE a.depth<4 AND NOT(t.id=ANY(a.path)) AND t."organizationId"=${organizationId} AND t.source='WHATSAPP_API' AND t."recipientEmail"=${recipient}
    ), target AS (
      SELECT t.* FROM "ServiceTicket" t JOIN aliases a ON a.id=t.id WHERE t."mergedIntoId" IS NULL ORDER BY a.depth DESC LIMIT 1
    ), thread_tickets AS (
      SELECT h.id FROM "ServiceTicket" h JOIN target t ON h."senderEmail"=t."senderEmail"
      WHERE h."organizationId"=${organizationId} AND h.source='WHATSAPP_API' AND h."recipientEmail"=${recipient}
        AND (h.id=t.id OR (h.status::text='RESOLVED' AND h."isSpam"=false AND h."mergedIntoId" IS NULL AND h."createdAt"<=t."createdAt"))
    ), cursor_row AS (
      SELECT m.id,m."receivedAt" FROM "ServiceMessage" m JOIN thread_tickets t ON t.id=m."ticketId"
      WHERE m.id=${beforeId||null} AND (m."providerMetadata"->>'accountPhone'=${phone} OR m."externalMessageId" LIKE ${`uazapi:${phone}:%`})
    ), message_page AS (
      SELECT m.* FROM "ServiceMessage" m JOIN thread_tickets t ON t.id=m."ticketId"
      WHERE (m."providerMetadata"->>'accountPhone'=${phone} OR m."externalMessageId" LIKE ${`uazapi:${phone}:%`})
        AND (${beforeId||null}::text IS NULL OR (m."receivedAt",m.id)<(SELECT "receivedAt",id FROM cursor_row))
      ORDER BY m."receivedAt" DESC,m.id DESC LIMIT 51
    )
    SELECT (${beforeId||null}::text IS NULL OR EXISTS(SELECT 1 FROM cursor_row)) AS "cursorValid",
      jsonb_build_object(
        'id',t.id,'subject',t.subject,'senderName',t."senderName",'senderEmail',t."senderEmail",'source',t.source,'snippet',t.snippet,'status',t.status,
        'routingArea',t."routingArea",'routingReason',t."routingReason",
        'assignedAt',to_char(t."assignedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'receivedAt',to_char(t."receivedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'resolvedAt',to_char(t."resolvedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'firstResponseAt',to_char(t."firstResponseAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'lastMessageAt',to_char(t."lastMessageAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'updatedAt',to_char(t."updatedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'client',(SELECT jsonb_build_object('id',c.id,'name',c.name,'document',c.document,'contaAzulConnection',CASE WHEN ca.id IS NULL THEN NULL ELSE jsonb_build_object('status',ca.status,'active',ca.active,'externalTenantName',ca."externalTenantName") END) FROM "Client" c LEFT JOIN "ContaAzulConnection" ca ON ca."clientId"=c.id AND ca."organizationId"=${organizationId} WHERE c.id=t."clientId" AND c."organizationId"=${organizationId}),
        'assignedTo',(SELECT jsonb_build_object('id',u.id,'name',u.name,'email',u.email) FROM "User" u WHERE u.id=t."assignedToId"),
        'previousTicketCount',(SELECT GREATEST(COUNT(*)-1,0) FROM thread_tickets),
        'messages',COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id',m.id,'sourceTicketId',m."ticketId",'direction',m.direction,'fromName',m."fromName",'textBody',m."textBody",'deliveryStatus',m."deliveryStatus",'receivedAt',to_char(m."receivedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'reaction',m."providerMetadata"->'hubReaction',
          'customerReactions',COALESCE((SELECT jsonb_agg(r.value) FROM (SELECT value FROM jsonb_each(COALESCE(m."providerMetadata"->'customerReactions','{}'::jsonb)) WHERE value->>'emoji'<>'' LIMIT 20) r),'[]'::jsonb),
          'attachments',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'mimeType',a."mimeType",'size',a.size) ORDER BY a."createdAt",a.id) FROM "ServiceAttachment" a WHERE a."messageId"=m.id),'[]'::jsonb)
        ) ORDER BY m."receivedAt" DESC,m.id DESC) FROM message_page m),'[]'::jsonb)
      ) AS payload FROM target t
  `);
  const row=rows[0];if(!row)return null;
  if(!row.cursorValid)throw new ConversationCursorError("Página de mensagens inválida.");
  return {...row.payload,messages:row.payload.messages.slice(0,50).reverse(),hasOlderMessages:row.payload.messages.length>50,history:[]};
}
