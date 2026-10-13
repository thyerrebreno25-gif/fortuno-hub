import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSalesReconciliationAccess } from "@/modules/sales-reconciliation/server/auth";

export async function GET() {
  const access = await getSalesReconciliationAccess();
  if (!access) {
    return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  }
  if (!access.permission.canView) {
    return NextResponse.json(
      { error: "Seu perfil não possui acesso à Conferência de vendas." },
      { status: 403 },
    );
  }

  const clients = await prisma.client.findMany({
    where: {
      organizationId: access.member.organizationId,
      active: true,
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      document: true,
      contaAzulConnection: {
        select: { active: true, status: true },
      },
    },
  });

  return NextResponse.json({
    clients,
    permission: access.permission,
  });
}
