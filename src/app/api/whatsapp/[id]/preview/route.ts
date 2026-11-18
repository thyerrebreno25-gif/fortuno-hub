import { NextResponse } from "next/server";
import { getServiceCenterMember, getWhatsAppPermission } from "@/modules/atendimento/auth";
import { currentWhatsAppAccount } from "@/modules/whatsapp/account-scope";
import { canViewWhatsAppManagement } from "@/modules/whatsapp/management-access";
import { readWhatsAppConversation } from "@/modules/whatsapp/conversation-read";
import { conversationPreview } from "@/modules/whatsapp/conversation-preview";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const member = await getServiceCenterMember();
    if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    const permission = await getWhatsAppPermission(member.organizationId, member.role);
    if (!canViewWhatsAppManagement(member.role, permission.canView)) return NextResponse.json({ error: "Prévia restrita à gestão." }, { status: 403 });
    const { id } = await context.params;
    if (!id || id.length > 100) return NextResponse.json({ error: "Conversa inválida." }, { status: 400 });
    const account = await currentWhatsAppAccount(member.organizationId);
    const ticket = await readWhatsAppConversation(id, member.organizationId, undefined, account);
    if (!ticket) return NextResponse.json({ error: "Conversa indisponível nesta conexão." }, { status: 404 });
    // Deliberately no mark-read, assignment, provider lookup or history mutation.
    return NextResponse.json({ preview: conversationPreview(ticket) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Não foi possível carregar a prévia." }, { status: 500 });
  }
}
