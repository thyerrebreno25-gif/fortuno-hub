import { NextResponse } from "next/server";
import { z } from "zod";
import { getServiceCenterMember, getWhatsAppPermission, SERVICE_CENTER_MANAGER_ROLES } from "@/modules/atendimento/auth";
import { currentWhatsAppAccount } from "@/modules/whatsapp/account-scope";
import { clearPaymentAlerts, lastPaymentCleanup, PaymentCleanupError, previewPaymentCleanup, restorePaymentCleanup } from "@/modules/whatsapp/payment-cleanup";
const headers = { "Cache-Control": "private, no-store" };
async function access() {
  const member = await getServiceCenterMember();
  if (!member || !SERVICE_CENTER_MANAGER_ROLES.has(member.role)) return null;
  const permission = await getWhatsAppPermission(member.organizationId, member.role);
  if (!permission.canView || !permission.canEdit) return null;
  const account = await currentWhatsAppAccount(member.organizationId);
  return account.recipient ? { organizationId: member.organizationId, userId: member.userId, recipient: account.recipient } : null;
}
const range = z.object({ mode: z.enum(["BEFORE", "PERIOD"]), from: z.string().max(10).optional(), to: z.string().length(10) }).strict();
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("PREVIEW"), range }).strict(),
  z.object({ action: z.literal("CLEAR"), range, fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ action: z.literal("RESTORE"), batchId: z.string().uuid() }).strict(),
]);
export async function GET() {
  const scope = await access();
  if (!scope) return NextResponse.json({ error: "Limpeza disponível somente para gestores com permissão de edição." }, { status: 403, headers });
  return NextResponse.json({ lastCleanup: await lastPaymentCleanup(scope) }, { headers });
}
export async function POST(request: Request) {
  const scope = await access();
  if (!scope) return NextResponse.json({ error: "Limpeza disponível somente para gestores com permissão de edição." }, { status: 403, headers });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Revise o período e confira a prévia da limpeza." }, { status: 400, headers });
  try {
    const input = parsed.data;
    const result = input.action === "RESTORE" ? await restorePaymentCleanup(scope, input.batchId)
      : input.action === "CLEAR" ? await clearPaymentAlerts(scope, input.range, input.fingerprint) : await previewPaymentCleanup(scope, input.range);
    return NextResponse.json(result, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof PaymentCleanupError ? error.message : "Não foi possível concluir a limpeza. Tente novamente." }, { status: error instanceof PaymentCleanupError ? error.status : 503, headers });
  }
}
