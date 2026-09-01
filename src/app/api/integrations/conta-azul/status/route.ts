import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findAuthorizedClient, getPurchaseInvoiceMember, getPurchaseInvoicePermission } from "@/modules/purchase-invoices/server/auth";
import { isContaAzulConfigured } from "@/modules/purchase-invoices/server/conta-azul";

export async function GET(request: Request) {
  const member = await getPurchaseInvoiceMember();
  if (!member) return NextResponse.json({ error: "Sua sessão expirou." }, { status: 401 });
  const permission = await getPurchaseInvoicePermission(member);
  if (!permission.canView) return NextResponse.json({ error: "Sem permissão para visualizar a integração." }, { status: 403 });
  const clientId = new URL(request.url).searchParams.get("clientId") || "";
  const client = await findAuthorizedClient(member, clientId);
  if (!client) return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
  const connection = await prisma.contaAzulConnection.findUnique({
    where: { clientId },
    select: { id: true, status: true, active: true, externalTenantName: true, tokenExpiresAt: true, lastSyncAt: true, lastError: true, updatedAt: true },
  });
  return NextResponse.json({ configured: isContaAzulConfigured(), connection, canManage: permission.canManage });
}
export async function DELETE(request: Request) {
  const member = await getPurchaseInvoiceMember();
  if (!member) return NextResponse.json({ error: "Sua sessão expirou." }, { status: 401 });
  const permission = await getPurchaseInvoicePermission(member);
  if (!permission.canManage) return NextResponse.json({ error: "Sem permissão para desconectar." }, { status: 403 });
  const clientId = new URL(request.url).searchParams.get("clientId") || "";
  const client = await findAuthorizedClient(member, clientId);
  if (!client) return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
  await prisma.contaAzulConnection.updateMany({
    where: { clientId, organizationId: member.organizationId },
    data: { active: false, status: "DISCONNECTED", encryptedAccessToken: "revoked", encryptedRefreshToken: "revoked", lastError: null },
  });
  return NextResponse.json({ message: "Conta Azul desconectada deste cliente." });
}
