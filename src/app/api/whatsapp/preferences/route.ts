import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServiceCenterMember, getWhatsAppPermission } from "@/modules/atendimento/auth";

async function viewer() {
  const member = await getServiceCenterMember();
  if (!member || member.role === "CLIENT") return null;
  return (await getWhatsAppPermission(member.organizationId, member.role)).canView ? member : null;
}
export async function GET() {
  const member = await viewer();
  if (!member) return NextResponse.json({ error: "Sem acesso ao WhatsApp." }, { status: 403 });
  const preference = await prisma.whatsAppOperatorPreference.findUnique({ where: { organizationId_userId: { organizationId: member.organizationId, userId: member.userId } } });
  return NextResponse.json({ notificationsMuted: preference?.notificationsMuted || false }, { headers: { "Cache-Control": "private, no-store" } });
}
export async function PATCH(request: Request) {
  const member = await viewer();
  if (!member) return NextResponse.json({ error: "Sem acesso ao WhatsApp." }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (typeof body?.notificationsMuted !== "boolean") return NextResponse.json({ error: "Preferência inválida." }, { status: 400 });
  const key = { organizationId: member.organizationId, userId: member.userId };
  await prisma.whatsAppOperatorPreference.upsert({ where: { organizationId_userId: key }, create: { ...key, notificationsMuted: body.notificationsMuted }, update: { notificationsMuted: body.notificationsMuted } });
  return NextResponse.json({ notificationsMuted: body.notificationsMuted });
}
export async function POST() {
  const member = await viewer();
  if (!member) return NextResponse.json({ error: "Sem acesso." }, { status: 403 });
  const key = { organizationId: member.organizationId, userId: member.userId };
  await prisma.whatsAppOperatorPreference.upsert({ where: { organizationId_userId: key }, create: { ...key, lastSeenAt: new Date() }, update: { lastSeenAt: new Date() } });
  return NextResponse.json({ ok: true });
}
