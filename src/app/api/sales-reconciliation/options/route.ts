import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchContaAzulRevenueCategories } from "@/modules/sales-reconciliation/server/conta-azul-source";
import { getSalesReconciliationAccess } from "@/modules/sales-reconciliation/server/auth";

export async function GET(request: Request) {
  const access = await getSalesReconciliationAccess();
  if (!access) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  if (!access.permission.canView) {
    return NextResponse.json({ error: "Sem permissão para consultar esta integração." }, { status: 403 });
  }
  const clientId = new URL(request.url).searchParams.get("clientId") || "";
  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId: access.member.organizationId, active: true },
    select: {
      id: true,
      contaAzulConnection: { select: { active: true, status: true } },
    },
  });
  if (!client) return NextResponse.json({ error: "Cliente inválido." }, { status: 404 });
  if (!client.contaAzulConnection?.active || client.contaAzulConnection.status !== "CONNECTED") {
    return NextResponse.json({ error: "Este cliente não está conectado ao Conta Azul." }, { status: 400 });
  }
  try {
    return NextResponse.json({ categories: await fetchContaAzulRevenueCategories(client.id) });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Não foi possível carregar as categorias.",
    }, { status: 502 });
  }
}
