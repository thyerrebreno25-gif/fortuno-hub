import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canSuperviseAudit, getAuditMember } from "@/modules/audit/auth";
import { fetchContaAzulRevenueCategories } from "@/modules/sales-reconciliation/server/conta-azul-source";

export async function GET(request: Request) {
  const member = await getAuditMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  if (!canSuperviseAudit(member.role, member.isTeamLeader)) {
    return NextResponse.json({ error: "Sem permissão para consultar esta integração." }, { status: 403 });
  }
  const clientId = new URL(request.url).searchParams.get("clientId") || "";
  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId: member.organizationId, active: true },
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
