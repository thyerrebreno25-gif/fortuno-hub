import { after, NextResponse } from "next/server";
import { getServiceCenterMember, getServiceCenterPermission } from "@/modules/atendimento/auth";
import { pollGmailConnections } from "@/modules/atendimento/gmail/sync";
export const maxDuration = 240;
export async function POST(request: Request) {
  const member = await getServiceCenterMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  const permission = await getServiceCenterPermission(member.organizationId, member.role);
  if (!permission.canView) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  const force = new URL(request.url).searchParams.get("force") === "1";
  if (force && !permission.canManage) return NextResponse.json({ error: "Sem permissão para antecipar a consulta." }, { status: 403 });
  after(async () => { await pollGmailConnections(member.organizationId, force); });
  return NextResponse.json({ accepted: true }, { status: 202 });
}
