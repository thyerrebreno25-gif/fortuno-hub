import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { accountMessageWhere, currentWhatsAppAccount } from "./account-scope";
export async function unreadCounts(organizationId: string, userId: string, ticketId?: string) {
  const account = await currentWhatsAppAccount(organizationId);
  const recipient = account.recipient;
  if (!recipient || account.connection?.status !== "CONNECTED" || account.connection.expiresAt && account.connection.expiresAt <= new Date()) return new Map<string, number>();
  const rows = await prisma.$queryRaw<Array<{ ticketId: string; count: number }>>(Prisma.sql`
    SELECT m."ticketId", COUNT(*)::int AS count FROM "ServiceMessage" m
    JOIN "ServiceTicket" t ON t.id = m."ticketId"
    LEFT JOIN "WhatsAppReadState" r ON r."ticketId" = t.id AND r."organizationId" = ${organizationId} AND r."userId" = ${userId}
    WHERE t."organizationId" = ${organizationId} AND t.source::text = 'WHATSAPP_API' AND t."recipientEmail" = ${recipient}
      AND t."mergedIntoId" IS NULL AND t."isSpam" = false AND m.direction::text = 'INBOUND'
      AND (m."providerMetadata"->>'accountPhone' = ${account.connection?.phone} OR m."externalMessageId" LIKE ${`uazapi:${account.connection?.phone}:%`})
      ${ticketId ? Prisma.sql`AND t.id = ${ticketId}` : Prisma.empty}
      AND (r."ticketId" IS NULL OR (m."receivedAt", m.id) > (r."readAt", r."lastMessageId"))
    GROUP BY m."ticketId"
  `);
  return new Map(rows.map(row => [row.ticketId, Number(row.count)]));
}
export async function markConversationRead(organizationId: string, userId: string, ticketId: string, messageId: string) {
  const account = await currentWhatsAppAccount(organizationId);
  const message = await prisma.serviceMessage.findFirst({ where: { id: messageId, ticketId, ticket: account.where, ...accountMessageWhere(account.connection) }, select: { id: true, receivedAt: true } });
  if (!message) return null;
  // Only advance to the last message actually rendered. A later arrival remains unread.
  await prisma.$executeRaw`INSERT INTO "WhatsAppReadState" ("organizationId", "userId", "ticketId", "readAt", "lastMessageId")
    VALUES (${organizationId}, ${userId}, ${ticketId}, ${message.receivedAt}, ${message.id})
    ON CONFLICT ("organizationId", "userId", "ticketId") DO UPDATE SET "readAt" = EXCLUDED."readAt", "lastMessageId" = EXCLUDED."lastMessageId"
    WHERE ("WhatsAppReadState"."readAt", "WhatsAppReadState"."lastMessageId") < (EXCLUDED."readAt", EXCLUDED."lastMessageId")`;
  return (await unreadCounts(organizationId, userId, ticketId)).get(ticketId) || 0;
}

export async function latestConversationDirections(organizationId: string, ticketIds: string[]) {
  if (!ticketIds.length) return new Map<string, string>();
  const rows = await prisma.$queryRaw<Array<{ticketId: string; direction: string}>>(Prisma.sql`
    SELECT t.id AS "ticketId", last.direction::text AS direction
    FROM "ServiceTicket" t
    CROSS JOIN LATERAL (SELECT m.direction FROM "ServiceMessage" m WHERE m."ticketId" = t.id AND m.direction::text <> 'INTERNAL' ORDER BY m."receivedAt" DESC, m.id DESC LIMIT 1) last
    WHERE t."organizationId" = ${organizationId} AND t.id IN (${Prisma.join(ticketIds)})
  `);
  return new Map(rows.map(row => [row.ticketId, row.direction]));
}
