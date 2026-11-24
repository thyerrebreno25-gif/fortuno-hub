import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { brazilDay, shiftDay } from "@/modules/operations/analytics";

export type PaymentCleanupRange = { mode: "BEFORE" | "PERIOD"; from?: string; to: string };
type SnapshotRow = { messageId: string; status: string; checkedAt: Date | null; createdAt: Date };
type Scope = { organizationId: string; userId: string; recipient: string };
const LIMIT = 5000;
export class PaymentCleanupError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
function date(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(+new Date(value + "T12:00:00Z")) || new Date(value + "T12:00:00Z").toISOString().slice(0, 10) !== value) throw new PaymentCleanupError("Informe datas válidas.");
  return value;
}
export function paymentCleanupPeriod(input: PaymentCleanupRange, now = new Date()) {
  const to = date(input.to), from = input.mode === "PERIOD" ? date(input.from || "") : null;
  if (!["BEFORE", "PERIOD"].includes(input.mode) || from && from > to || to > brazilDay(now)) throw new PaymentCleanupError("Revise o período da limpeza.");
  return { start: from ? new Date(from + "T00:00:00-03:00") : null, end: new Date((input.mode === "BEFORE" ? to : shiftDay(to, 1)) + "T00:00:00-03:00") };
}
function where(scope: Scope, range: PaymentCleanupRange) {
  const period = paymentCleanupPeriod(range);
  return Prisma.sql`p."organizationId"=${scope.organizationId} AND p."accountRecipient"=${scope.recipient}
    AND p."clearedAt" IS NULL AND t."organizationId"=${scope.organizationId}
    AND t.source='WHATSAPP_API' AND t."recipientEmail"=${scope.recipient}
    AND t."mergedIntoId" IS NULL AND t."isSpam"=false
    AND p."createdAt" < ${period.end} ${period.start ? Prisma.sql`AND p."createdAt" >= ${period.start}` : Prisma.empty}`;
}
function summarize(rows: SnapshotRow[], scope: Scope, range: PaymentCleanupRange) {
  if (rows.length > LIMIT) throw new PaymentCleanupError("Selecione um período menor: cada limpeza permite até 5.000 alertas.");
  const fingerprint = createHash("sha256").update(JSON.stringify([scope.organizationId, scope.recipient, range.mode, range.from || null, range.to,
    rows.map(row => [row.messageId, row.status, row.checkedAt?.toISOString() || null, row.createdAt.toISOString()])])).digest("hex");
  return { count: rows.length, pending: rows.filter(row => row.status === "PENDING").length, checked: rows.filter(row => row.status !== "PENDING").length, fingerprint };
}
function select(scope: Scope, range: PaymentCleanupRange, lock = false) {
  return Prisma.sql`SELECT p."messageId",p.status,p."checkedAt",p."createdAt" FROM "WhatsAppPaymentRequest" p
    JOIN "ServiceMessage" m ON m.id=p."messageId" JOIN "ServiceTicket" t ON t.id=m."ticketId"
    WHERE ${where(scope, range)} ORDER BY p."messageId" LIMIT ${LIMIT + 1} ${lock ? Prisma.sql`FOR UPDATE OF p` : Prisma.empty}`;
}
export async function previewPaymentCleanup(scope: Scope, range: PaymentCleanupRange) {
  return summarize(await prisma.$queryRaw<SnapshotRow[]>(select(scope, range)), scope, range);
}
export async function clearPaymentAlerts(scope: Scope, range: PaymentCleanupRange, fingerprint: string) {
  return prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<SnapshotRow[]>(select(scope, range, true));
    const preview = summarize(rows, scope, range);
    if (preview.fingerprint !== fingerprint) throw new PaymentCleanupError("A seleção mudou. Confira a prévia novamente antes de limpar.", 409);
    if (!rows.length) throw new PaymentCleanupError("Não há alertas nesse período.", 409);
    const batchId = randomUUID();
    const count = await tx.$executeRaw(Prisma.sql`UPDATE "WhatsAppPaymentRequest" SET "clearedAt"=CURRENT_TIMESTAMP,"clearedById"=${scope.userId},"clearedBatchId"=${batchId}
      WHERE "organizationId"=${scope.organizationId} AND "accountRecipient"=${scope.recipient} AND "clearedAt" IS NULL AND "messageId" IN (${Prisma.join(rows.map(row => row.messageId))})`);
    if (count !== rows.length) throw new PaymentCleanupError("A seleção mudou. Nenhum alerta foi limpo; atualize a prévia.", 409);
    await tx.auditLog.create({ data: { userId: scope.userId, action: "WHATSAPP_PAYMENT_ALERTS_CLEARED", entity: "WhatsAppAccount", entityId: scope.recipient, afterData: { organizationId: scope.organizationId, batchId, range, count, pending: preview.pending } } });
    return { batchId, count };
  });
}
export async function lastPaymentCleanup(scope: Scope) {
  const rows = await prisma.$queryRaw<Array<{ batchId: string; count: number }>>(Prisma.sql`SELECT "clearedBatchId" AS "batchId",count(*)::int AS count FROM "WhatsAppPaymentRequest"
    WHERE "organizationId"=${scope.organizationId} AND "accountRecipient"=${scope.recipient} AND "clearedById"=${scope.userId} AND "clearedAt" IS NOT NULL AND "clearedBatchId" IS NOT NULL
    GROUP BY "clearedBatchId" ORDER BY max("clearedAt") DESC LIMIT 1`);
  return rows[0] || null;
}
export async function restorePaymentCleanup(scope: Scope, batchId: string) {
  return prisma.$transaction(async tx => {
    const count = await tx.$executeRaw(Prisma.sql`UPDATE "WhatsAppPaymentRequest" SET "clearedAt"=NULL,"clearedById"=NULL,"clearedBatchId"=NULL
      WHERE "organizationId"=${scope.organizationId} AND "accountRecipient"=${scope.recipient} AND "clearedById"=${scope.userId} AND "clearedBatchId"=${batchId} AND "clearedAt" IS NOT NULL`);
    if (!count) throw new PaymentCleanupError("Limpeza indisponível ou já desfeita.", 409);
    await tx.auditLog.create({ data: { userId: scope.userId, action: "WHATSAPP_PAYMENT_ALERTS_RESTORED", entity: "WhatsAppAccount", entityId: scope.recipient, afterData: { organizationId: scope.organizationId, batchId, count } } });
    return { count };
  });
}
