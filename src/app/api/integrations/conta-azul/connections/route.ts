import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getPurchaseInvoiceMember,
  getPurchaseInvoicePermission,
} from "@/modules/purchase-invoices/server/auth";
import { isContaAzulConfigured } from "@/modules/purchase-invoices/server/conta-azul";

export async function GET() {
  try {
    const member = await getPurchaseInvoiceMember();

    if (!member) {
      return NextResponse.json(
        { error: "Sua sessão expirou." },
        { status: 401 },
      );
    }

    const permission = await getPurchaseInvoicePermission(member);

    if (!permission.canView) {
      return NextResponse.json(
        { error: "Sem permissão para visualizar a integração." },
        { status: 403 },
      );
    }

    const clients = await prisma.client.findMany({
      where: {
        organizationId: member.organizationId,
        active: true,
      },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        document: true,
        contaAzulConnection: {
          select: {
            status: true,
            active: true,
            externalTenantName: true,
            lastSyncAt: true,
            lastError: true,
            updatedAt: true,
          },
        },
      },
    });

    return NextResponse.json({
      configured: isContaAzulConfigured(),
      canManage: permission.canManage,
      clients: clients.map(({ contaAzulConnection, ...client }) => ({
        ...client,
        connection: contaAzulConnection,
      })),
    });
  } catch (error) {
    console.error("Erro ao listar vínculos Conta Azul:", error);
    return NextResponse.json(
      { error: "Não foi possível carregar os vínculos do Conta Azul." },
      { status: 500 },
    );
  }
}
