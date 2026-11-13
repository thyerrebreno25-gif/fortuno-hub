import {paymentRequestNotifications} from "./payment-requests";
import { currentWhatsAppAccount } from "./account-scope";
import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

export async function whatsappNotifications(organizationId: string, userId: string, manageQueue: boolean, now = new Date()) {
  const account = await currentWhatsAppAccount(organizationId);
  if (!account.recipient) return [];
  const rows = await prisma.$queryRaw<Array<{ id: string; ticketId: string; senderName: string | null; receivedAt: Date }>>(Prisma.sql`
    SELECT DISTINCT ON (t.id) m.id, t.id AS "ticketId", t."senderName", m."receivedAt"
    FROM "ServiceTicket" t JOIN "ServiceMessage" m ON m."ticketId" = t.id
    LEFT JOIN "WhatsAppOperationStart" baseline ON baseline."organizationId"=t."organizationId" AND baseline."accountRecipient"=t."recipientEmail"
    LEFT JOIN "WhatsAppReadState" r ON r."ticketId" = t.id AND r."organizationId" = ${organizationId} AND r."userId" = ${userId}
    WHERE t."organizationId" = ${organizationId} AND t.source::text = 'WHATSAPP_API' AND t."recipientEmail" = ${account.recipient}
      AND (baseline."startedAt" IS NULL OR m."receivedAt">baseline."startedAt")
      AND t."mergedIntoId" IS NULL AND t."isSpam" = false AND t.status::text NOT IN ('RESOLVED', 'SPAM')
      AND (t."assignedToId" = ${userId} OR (${manageQueue} AND t."assignedToId" IS NULL))
      AND (m."providerMetadata"->>'accountPhone' = ${account.connection?.phone} OR m."externalMessageId" LIKE ${`uazapi:${account.connection?.phone}:%`})
      AND m.direction::text = 'INBOUND' AND m."receivedAt" >= ${new Date(now.getTime() - 24 * 60 * 60 * 1000)}
      AND COALESCE(m."providerMetadata"->>'historical', 'false') <> 'true'
      AND (r."ticketId" IS NULL OR (m."receivedAt", m.id) > (r."readAt", r."lastMessageId"))
    ORDER BY t.id, m."receivedAt" DESC, m.id DESC
  `);
  const paymentItems=await paymentRequestNotifications(organizationId,userId,manageQueue);
  return [...paymentItems,...rows.sort((a,b) => b.receivedAt.getTime() - a.receivedAt.getTime()).slice(0,20).map(row => ({
    id: `whatsapp-message-${row.id}`, type: "INFO" as const, title: "Nova mensagem no WhatsApp",
    description: row.senderName || "Conversa aguardando leitura", href: `/whatsapp?ticket=${encodeURIComponent(row.ticketId)}`,
    createdAt: row.receivedAt.toISOString(), popup: true, priority: 4,
  }))];
}


// Sound is based on arrival, independently of the unread state of the selected chat.
export async function whatsappSoundEvents(organizationId:string,userId:string,includeQueue:boolean,since:string|null,now=new Date()){
 const parsed=Date.parse(since||"");if(!Number.isFinite(parsed))return [];
 const after=new Date(Math.max(now.getTime()-120000,Math.min(parsed,now.getTime())));
 const account=await currentWhatsAppAccount(organizationId);if(!account.recipient)return [];
 const rows=await prisma.$queryRaw<Array<{id:string;arrivedAt:Date}>>(Prisma.sql`
   SELECT m.id,m."createdAt" AS "arrivedAt" FROM "ServiceMessage" m JOIN "ServiceTicket" t ON t.id=m."ticketId"
   LEFT JOIN "WhatsAppOperationStart" baseline ON baseline."organizationId"=t."organizationId" AND baseline."accountRecipient"=t."recipientEmail"
   WHERE t."organizationId"=${organizationId} AND t.source::text='WHATSAPP_API' AND t."recipientEmail"=${account.recipient}
     AND t."mergedIntoId" IS NULL AND t."isSpam"=false AND t.status::text NOT IN ('RESOLVED','SPAM')
     AND (t."assignedToId"=${userId} OR (${includeQueue} AND t."assignedToId" IS NULL))
     AND (m."providerMetadata"->>'accountPhone'=${account.connection?.phone} OR m."externalMessageId" LIKE ${`uazapi:${account.connection?.phone}:%`})
     AND m.direction::text='INBOUND' AND COALESCE(m."providerMetadata"->>'historical','false')<>'true'
     AND m."createdAt">=${after} AND m."createdAt"<=${now}
     AND (baseline."startedAt" IS NULL OR m."receivedAt">baseline."startedAt")
   ORDER BY m."createdAt" DESC,m.id DESC LIMIT 20
 `);
 return rows.map(row=>({id:`whatsapp-message-${row.id}`,createdAt:row.arrivedAt.toISOString()}));
}
