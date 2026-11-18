import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getServiceCenterMember, getWhatsAppPermission } from "@/modules/atendimento/auth";
import { currentWhatsAppAccount } from "@/modules/whatsapp/account-scope";
import { canViewWhatsAppManagement } from "@/modules/whatsapp/management-access";
import { attentionStartedAt, ATTENTION_RESET } from "@/modules/whatsapp/attention-start";
import { liveMonitoringTag } from "@/modules/whatsapp/monitoring-cache";
const schema = z.object({ accountRecipient: z.string().min(1).max(200), requestId: z.string().uuid() });
export async function POST(request: Request) {
  try {
    const member = await getServiceCenterMember();
    if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    const permission = await getWhatsAppPermission(member.organizationId, member.role);
    if (!canViewWhatsAppManagement(member.role, permission.canView) || !permission.canEdit) return NextResponse.json({ error: "Ação restrita à gestão com permissão de edição." }, { status: 403 });
    const input = schema.safeParse(await request.json().catch(() => null));
    if (!input.success) return NextResponse.json({ error: "Reabra a confirmação para reiniciar os tempos." }, { status: 400 });
    const account = await currentWhatsAppAccount(member.organizationId);
    if (!account.recipient || account.recipient !== input.data.accountRecipient) return NextResponse.json({ error: "O número conectado mudou. Atualize o monitoramento." }, { status: 409 });
    const recipient=account.recipient;
    const startedAt = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"wa-attention-reset:" + member.organizationId}))`;
      const repeated = await tx.auditLog.findFirst({ where: { entity: "Organization", entityId: member.organizationId, action: ATTENTION_RESET, AND: [{ afterData: { path: ["requestId"], equals: input.data.requestId } }, { afterData: { path: ["accountRecipient"], equals: recipient } }] }, select: { createdAt: true } });
      if (repeated) return repeated.createdAt;
      const previous = await attentionStartedAt(member.organizationId, account.recipient, tx);
      const now = new Date();
      await tx.auditLog.create({ data: { userId: member.userId, entity: "Organization", entityId: member.organizationId, action: ATTENTION_RESET, createdAt: now, beforeData: { startedAt: previous?.toISOString() || null }, afterData: { accountRecipient: account.recipient, requestId: input.data.requestId, startedAt: now.toISOString() } } });
      return now;
    });
    try { revalidateTag(liveMonitoringTag(member.organizationId, account.recipient), { expire: 0 }); } catch { /* The persisted reference is already effective on the next read. */ }
    return NextResponse.json({ startedAt: startedAt.toISOString() });
  } catch {
    return NextResponse.json({ error: "Não foi possível reiniciar os tempos de atenção." }, { status: 500 });
  }
}
