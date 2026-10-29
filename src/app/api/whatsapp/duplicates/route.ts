import { NextResponse } from "next/server";
import { z } from "zod";
import { getServiceCenterMember, getWhatsAppPermission } from "@/modules/atendimento/auth";
import { whatsappConnection } from "@/modules/whatsapp/uazapi-server";
import { duplicatePlan, MergeConflict, mergeDuplicates, planView } from "@/modules/whatsapp/merge";
export const maxDuration = 120;
async function access() {
  const member = await getServiceCenterMember();
  if (!member) return { error: "Sessão inválida.", status: 401 } as const;
  const permission = await getWhatsAppPermission(member.organizationId, member.role);
  if (!permission.canEdit || member.role !== "MASTER" && !permission.canManage) return { error: "Somente gestores autorizados podem reunir atendimentos.", status: 403 } as const;
  const connection = await whatsappConnection(member.organizationId);
  if (!connection?.phone) return { error: "Não há um número identificado nesta integração.", status: 409 } as const;
  return { member, connection };
}
export async function GET() {
  const auth = await access();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try { return NextResponse.json(planView(await duplicatePlan(auth.connection)), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof MergeConflict ? error.message : "Não foi possível verificar os duplicados." }, { status: 409 }); }
}
export async function POST(request: Request) {
  const auth = await access();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const input = z.object({ confirmation: z.literal("UNIR_ATENDIMENTOS"), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Confira a prévia e confirme a união dos atendimentos." }, { status: 400 });
  try { return NextResponse.json(await mergeDuplicates(auth.connection, auth.member.userId, input.data.fingerprint)); }
  catch (error) { return NextResponse.json({ error: error instanceof MergeConflict ? error.message : "Não foi possível concluir a união. Atualize a prévia para conferir os registros." }, { status: 409 }); }
}
