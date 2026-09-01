import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findAuthorizedClient, getPurchaseInvoiceMember, getPurchaseInvoicePermission } from "@/modules/purchase-invoices/server/auth";
import { isContaAzulConfigured } from "@/modules/purchase-invoices/server/conta-azul";

export async function GET(request: Request) {
  const member = await getPurchaseInvoiceMember();
  if (!member) return NextResponse.json({ error: "Sua sessão expirou." }, { status: 401 });
  const permission = await getPurchaseInvoicePermission(member);
  if (!permission.canView) return NextResponse.json({ error: "Você não possui permissão para visualizar notas fiscais." }, { status: 403 });

  const clientId = new URL(request.url).searchParams.get("clientId") || "";
  const client = await findAuthorizedClient(member, clientId);
  if (!client) return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });

  const [connection, invoices] = await Promise.all([
    prisma.contaAzulConnection.findUnique({
      where: { clientId },
      select: { id: true, status: true, active: true, externalTenantName: true, tokenExpiresAt: true, lastSyncAt: true, lastError: true, updatedAt: true },
    }),
    prisma.purchaseInvoice.findMany({
      where: { clientId, organizationId: member.organizationId },
      orderBy: [{ status: "asc" }, { issueDate: "desc" }, { createdAt: "desc" }],
      include: { items: { orderBy: { lineNumber: "asc" } } },
      take: 100,
    }),
  ]);

  return NextResponse.json({
    client,
    configured: isContaAzulConfigured(),
    connection,
    permission,
    limitations: {
      incomingInvoicesApi: false,
      webhooks: false,
      message: "A API pública da Conta Azul ainda não lista notas de entrada ou compras. Importe o XML da NF-e para revisar os itens e gerar a despesa rateada com segurança.",
    },
    invoices: invoices.map((invoice) => ({
      ...invoice,
      totalProducts: Number(invoice.totalProducts),
      totalInvoice: Number(invoice.totalInvoice),
      items: invoice.items.map((item) => ({
        ...item,
        quantity: Number(item.quantity),
        unitValue: Number(item.unitValue),
        totalValue: Number(item.totalValue),
        allocationAmount: Number(item.allocationAmount),
      })),
    })),
  });
}
