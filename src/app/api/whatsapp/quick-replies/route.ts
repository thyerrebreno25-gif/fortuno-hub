import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getServiceCenterMember, getWhatsAppPermission } from "@/modules/atendimento/auth";
import { canViewWhatsAppManagement } from "@/modules/whatsapp/management-access";
const schema = z.object({ id: z.string().max(100).optional(), title: z.string().trim().min(1).max(100), body: z.string().trim().min(1).max(5000) });
export async function GET() {
  const member = await getServiceCenterMember();
  if (!member || member.role === "CLIENT" || !(await getWhatsAppPermission(member.organizationId, member.role)).canView) return NextResponse.json({ error: "Sem acesso." }, { status: 403 });
  return NextResponse.json({ items: await prisma.whatsAppQuickReply.findMany({ where: { organizationId: member.organizationId }, orderBy: { title: "asc" }, take: 300 }), canManage: canViewWhatsAppManagement(member.role, true) }, { headers: { "Cache-Control": "private, no-store" } });
}
export async function POST(request: Request) {
  const member = await getServiceCenterMember();
  const permission = member && await getWhatsAppPermission(member.organizationId, member.role);
  if (!member || !permission?.canEdit || !canViewWhatsAppManagement(member.role, permission.canView)) return NextResponse.json({ error: "Cadastro restrito à gestão." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Preencha título e mensagem (até 5.000 caracteres)." }, { status: 400 });
  const { id, ...data } = parsed.data;
  if (id) {
    const updated = await prisma.whatsAppQuickReply.updateMany({ where: { id, organizationId: member.organizationId }, data });
    if (!updated.count) return NextResponse.json({ error: "Mensagem não encontrada." }, { status: 404 });
  } else {
    if (await prisma.whatsAppQuickReply.count({ where: { organizationId: member.organizationId } }) >= 300) return NextResponse.json({ error: "Limite de 300 mensagens padrão atingido." }, { status: 400 });
    await prisma.whatsAppQuickReply.create({ data: { ...data, organizationId: member.organizationId, createdById: member.userId } });
  }
  return NextResponse.json({ ok: true });
}
export async function DELETE(request: Request) {
  const member = await getServiceCenterMember();
  const permission = member && await getWhatsAppPermission(member.organizationId, member.role);
  if (!member || !permission?.canEdit || !canViewWhatsAppManagement(member.role, permission.canView)) return NextResponse.json({ error: "Cadastro restrito à gestão." }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (typeof body?.id !== "string") return NextResponse.json({ error: "Mensagem inválida." }, { status: 400 });
  await prisma.whatsAppQuickReply.deleteMany({ where: { id: body.id, organizationId: member.organizationId } });
  return NextResponse.json({ ok: true });
}
