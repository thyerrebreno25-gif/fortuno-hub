import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { WHATSAPP_SOURCES } from "./core";
export async function unreadCounts(organizationId: string, userId: string, ticketId?: string) {
  const rows = await prisma.$queryRaw<Array<{ ticketId: string; count: number }>>(Prisma.sql`
    SELECT m."ticketId", COUNT(*)::int AS count FROM "ServiceMessage" m
    JOIN "ServiceTicket" t ON t.id = m."ticketId"
    LEFT JOIN "WhatsAppReadState" r ON r."ticketId" = t.id AND r."organizationId" = ${organizationId} AND r."userId" = ${userId}
    WHERE t."organizationId" = ${organizationId} AND t.source::text IN (${Prisma.join([...WHATSAPP_SOURCES])})
      AND t."mergedIntoId" IS NULL AND t."isSpam" = false AND m.direction::text = 'INBOUND'
      ${ticketId ? Prisma.sql`AND t.id = ${ticketId}` : Prisma.empty}
      AND (r."ticketId" IS NULL OR (m."receivedAt", m.id) > (r."readAt", r."lastMessageId"))
    GROUP BY m."ticketId"
  `);
  return new Map(rows.map(row => [row.ticketId, Number(row.count)]));
}
export async function markConversationRead(organizationId: string, userId: string, ticketId: string, messageId: string) {
  const message = await prisma.serviceMessage.findFirst({ where: { id: messageId, ticketId, ticket: { organizationId, source: { in: [...WHATSAPP_SOURCES] } } }, select: { id: true, receivedAt: true } });
  if (!message) return null;
  // Only advance to the last message actually rendered. A later arrival remains unread.
  await prisma.$executeRaw`INSERT INTO "WhatsAppReadState" ("organizationId", "userId", "ticketId", "readAt", "lastMessageId")
    VALUES (${organizationId}, ${userId}, ${ticketId}, ${message.receivedAt}, ${message.id})
    ON CONFLICT ("organizationId", "userId", "ticketId") DO UPDATE SET "readAt" = EXCLUDED."readAt", "lastMessageId" = EXCLUDED."lastMessageId"
    WHERE ("WhatsAppReadState"."readAt", "WhatsAppReadState"."lastMessageId") < (EXCLUDED."readAt", EXCLUDED."lastMessageId")`;
  return (await unreadCounts(organizationId, userId, ticketId)).get(ticketId) || 0;
}
