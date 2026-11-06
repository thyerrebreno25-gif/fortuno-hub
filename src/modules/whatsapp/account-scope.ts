import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
export type WhatsAppAccount = { id: string; organizationId: string; instanceId: string; phone: string | null; status: string; expiresAt: Date | null; webhookConfiguredAt: Date | null };
export function accountRecipient(account: Pick<WhatsAppAccount, "id" | "phone"> | null) {
  return account?.phone ? `wa-account:${account.id}:${account.phone}` : null;
}
export function accountTicketWhere(organizationId: string, account: WhatsAppAccount | null): Prisma.ServiceTicketWhereInput {
  const available = account?.organizationId === organizationId && account.status === "CONNECTED" && account.phone && (!account.expiresAt || account.expiresAt > new Date());
  return { organizationId, source: "WHATSAPP_API", ...(available ? { recipientEmail: accountRecipient(account)! } : { id: { in: [] } }) };
}
export async function currentWhatsAppAccount(organizationId: string, database: Pick<typeof prisma, "whatsAppConnection"> = prisma) {
  const connection = await database.whatsAppConnection.findUnique({ where: { organizationId }, select: { id: true, organizationId: true, instanceId: true, phone: true, status: true, expiresAt: true, webhookConfiguredAt: true } });
  const where = accountTicketWhere(organizationId, connection);
  return { connection, where, recipient: typeof where.recipientEmail === "string" ? where.recipientEmail : null, accountKey: connection?.phone ? accountRecipient(connection) : null };
}

export function accountMessageWhere(account: Pick<WhatsAppAccount, "phone"> | null): Prisma.ServiceMessageWhereInput {
  return account?.phone ? { OR: [{ providerMetadata: { path: ["accountPhone"], equals: account.phone } }, { externalMessageId: { startsWith: `uazapi:${account.phone}:` } }] } : { id: { in: [] } };
}
