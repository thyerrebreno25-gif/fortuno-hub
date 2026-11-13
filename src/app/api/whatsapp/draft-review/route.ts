import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getServiceCenterMember, getWhatsAppPermission } from "@/modules/atendimento/auth";
import { currentWhatsAppAccount } from "@/modules/whatsapp/account-scope";
import { reviewWhatsAppDraft } from "@/modules/whatsapp/draft-review";
export const maxDuration = 60;
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const member = await getServiceCenterMember();
    if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401, headers });
    const permission = await getWhatsAppPermission(member.organizationId, member.role);
    if (!permission.canEdit || member.role === "CLIENT") return NextResponse.json({ error: "Sem permissão." }, { status: 403, headers });
    if (Number(request.headers.get("content-length") || 0) > 22000) return NextResponse.json({ error: "Texto muito longo." }, { status: 400, headers });
    const raw = await request.text(); if (raw.length > 22000) return NextResponse.json({ error: "Texto muito longo." }, { status: 400, headers });
    const { ticketId, text, internal } = z.object({ ticketId: z.string().min(1).max(100), text: z.string().trim().min(2).max(5000), internal: z.boolean().default(false) }).parse(JSON.parse(raw));
    const account = await currentWhatsAppAccount(member.organizationId);
    const ticket = await prisma.serviceTicket.findFirst({ where: { ...account.where, id: ticketId }, select: { assignedToId: true, status: true } });
    if (!ticket) return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404, headers });
    if (!internal && (ticket.assignedToId !== member.userId || ticket.status === "RESOLVED")) return NextResponse.json({ error: "Assuma o chamado antes de revisar a resposta." }, { status: 403, headers });
    if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "O revisor aguarda a configuração da IA do Hub." }, { status: 503, headers });
    const allowed = await prisma.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`draft-review:${member.userId}`}))`;
      const count = await tx.auditLog.count({ where: { userId: member.userId, action: "WHATSAPP_DRAFT_REVIEW", createdAt: { gte: new Date(Date.now()-300000) } } });
      if (count >= 40) return false;
      await tx.auditLog.create({ data: { userId: member.userId, action: "WHATSAPP_DRAFT_REVIEW", entity: "ServiceTicket", entityId: ticketId } });
      return true;
    });
    if (!allowed) return NextResponse.json({ error: "Aguarde alguns minutos para revisar outra mensagem." }, { status: 429, headers });
    return NextResponse.json(await reviewWhatsAppDraft(text), { headers });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: "Informe um rascunho de 2 a 5.000 caracteres." }, { status: 400, headers });
    // Do not log draft content or provider responses.
    return NextResponse.json({ error: error instanceof Error && /^(O revisor|A IA|A revisão)/.test(error.message) ? error.message : "Não foi possível revisar agora. Seu rascunho foi preservado." }, { status: 503, headers });
  }
}
