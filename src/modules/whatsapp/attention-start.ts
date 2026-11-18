import "server-only";
import { prisma } from "@/lib/prisma";
export const ATTENTION_RESET = "WHATSAPP_ATTENTION_RESET";
export async function attentionStartedAt(organizationId: string, recipient: string | null, database: Pick<typeof prisma, "auditLog"> = prisma) {
  if (!recipient) return null;
  const row = await database.auditLog.findFirst({ where: { entity: "Organization", entityId: organizationId, action: ATTENTION_RESET, afterData: { path: ["accountRecipient"], equals: recipient } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  return row?.createdAt || null;
}
