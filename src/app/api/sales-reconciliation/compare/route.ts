import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canSuperviseAudit, getAuditMember } from "@/modules/audit/auth";
import { normalizedKey, reconcileSales } from "@/modules/sales-reconciliation/engine";
import { fetchContaAzulReceivables } from "@/modules/sales-reconciliation/server/conta-azul-source";
import type { SalesDestinationRule, SalesSpreadsheetEntry } from "@/modules/sales-reconciliation/types";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: unknown) {
  return typeof value === "string" && DATE.test(value) ? value : null;
}

function validEntry(value: unknown): value is SalesSpreadsheetEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Partial<SalesSpreadsheetEntry>;
  return typeof entry.id === "string"
    && typeof entry.sourceRow === "number"
    && typeof entry.paymentDate === "string"
    && typeof entry.amount === "number"
    && typeof entry.destinationLabel === "string";
}

function validRule(value: unknown): value is SalesDestinationRule {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rule = value as Partial<SalesDestinationRule>;
  return typeof rule.sourceLabel === "string" && typeof rule.clientId === "string";
}

export async function POST(request: Request) {
  const member = await getAuditMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  if (!canSuperviseAudit(member.role, member.isTeamLeader)) {
    return NextResponse.json({ error: "Apenas líderes podem iniciar esta conferência." }, { status: 403 });
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const periodStart = validDate(body?.periodStart);
  const periodEnd = validDate(body?.periodEnd);
  const entries = Array.isArray(body?.entries) ? body.entries.filter(validEntry) : [];
  const rules = Array.isArray(body?.rules) ? body.rules.filter(validRule) : [];
  if (!periodStart || !periodEnd || periodStart > periodEnd) {
    return NextResponse.json({ error: "Informe um período válido." }, { status: 400 });
  }
  if (entries.length > 5_000) {
    return NextResponse.json({ error: "A conferência aceita até 5.000 linhas por execução." }, { status: 400 });
  }
  const selectedEntries = entries.filter((entry) => (
    entry.paymentDate >= periodStart
    && entry.paymentDate <= periodEnd
    && !normalizedKey(entry.paymentMethod).split(" ").includes("DINHEIRO")
  ));
  if (!selectedEntries.length) {
    return NextResponse.json({ error: "Não há vendas com DATA PG dentro do período escolhido." }, { status: 400 });
  }
  const clientIds = Array.from(new Set(rules.map((rule) => rule.clientId).filter(Boolean)));
  const clients = await prisma.client.findMany({
    where: { id: { in: clientIds }, organizationId: member.organizationId, active: true },
    select: {
      id: true,
      name: true,
      contaAzulConnection: { select: { active: true, status: true } },
    },
  });
  if (clients.length !== clientIds.length) {
    return NextResponse.json({ error: "Um dos cadastros de destino é inválido." }, { status: 400 });
  }
  const disconnected = clients.find((client) => !client.contaAzulConnection?.active || client.contaAzulConnection.status !== "CONNECTED");
  if (disconnected) {
    return NextResponse.json({ error: `${disconnected.name} ainda não está conectado ao Conta Azul.` }, { status: 400 });
  }

  try {
    const receivablesByClient: Record<string, { clientName: string; items: Awaited<ReturnType<typeof fetchContaAzulReceivables>> }> = {};
    // O refresh token do Conta Azul é rotativo; mantenha as consultas sequenciais.
    for (const client of clients) {
      receivablesByClient[client.id] = {
        clientName: client.name,
        items: await fetchContaAzulReceivables(client.id, periodStart, periodEnd),
      };
    }
    return NextResponse.json(reconcileSales({ entries: selectedEntries, rules, receivablesByClient }));
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Não foi possível consultar o Conta Azul.",
    }, { status: 502 });
  }
}
