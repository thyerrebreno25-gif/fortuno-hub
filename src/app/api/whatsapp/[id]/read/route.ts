import { NextResponse } from "next/server";
import { getServiceCenterMember, getWhatsAppPermission } from "@/modules/atendimento/auth";
import { markConversationRead } from "@/modules/whatsapp/read-state";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const member = await getServiceCenterMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  if (!(await getWhatsAppPermission(member.organizationId, member.role)).canView) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (typeof body?.messageId !== "string" || !body.messageId || body.messageId.length > 200) return NextResponse.json({ error: "Mensagem inválida." }, { status: 400 });
  const { id } = await context.params;
  const count = await markConversationRead(member.organizationId, member.userId, id, body.messageId);
  if (count === null) return NextResponse.json({ error: "Mensagem não encontrada." }, { status: 404 });
  return NextResponse.json({ unreadCount: count });
}
