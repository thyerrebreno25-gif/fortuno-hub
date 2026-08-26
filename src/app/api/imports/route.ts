import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { ImportModule, ImportStatus, TransactionType } from "@/generated/prisma/enums";

async function getContext() {
  const supabase = await createSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const membership = await prisma.organizationMember.findFirst({
    where: { userId: user.id }, orderBy: { createdAt: "asc" },
    select: { organizationId: true, userId: true },
  });
  return membership;
}


export async function GET(request: Request) {
  try {
    const context = await getContext();
    if (!context) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    const url = new URL(request.url);
    const take = Math.min(Math.max(Number(url.searchParams.get("take") || 50), 1), 200);
    const rows = await prisma.importJob.findMany({
      where: { organizationId: context.organizationId },
      orderBy: { createdAt: "desc" },
      take,
      include: {
        client: { select: { name: true } },
        user: { select: { name: true, email: true } },
        _count: { select: { transactions: true } },
      },
    });
    return NextResponse.json({
      imports: rows.map((item) => ({
        id: item.id,
        module: item.module,
        status: item.status,
        originalName: item.originalName,
        clientName: item.client?.name ?? null,
        userName: item.user.name || item.user.email,
        expectedTotal: item.expectedTotal ? Number(item.expectedTotal) : null,
        parsedTotal: item.parsedTotal ? Number(item.parsedTotal) : null,
        difference: item.difference ? Number(item.difference) : null,
        metadata: item.metadata,
        transactionCount: item._count.transactions,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Erro ao listar importações:", error);
    return NextResponse.json({ error: "Não foi possível carregar o histórico." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await getContext();
    if (!context) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    const body = await request.json();
    if (!Object.values(ImportModule).includes(body.module) || !Object.values(ImportStatus).includes(body.status)) {
      return NextResponse.json({ error: "Módulo ou status inválido." }, { status: 400 });
    }
    if (!body.originalName?.trim()) return NextResponse.json({ error: "Nome do arquivo obrigatório." }, { status: 400 });

    if (body.clientId) {
      const client = await prisma.client.findFirst({ where: { id: body.clientId, organizationId: context.organizationId }, select: { id: true } });
      if (!client) return NextResponse.json({ error: "Cliente inválido para esta organização." }, { status: 400 });
    }

    const created = await prisma.importJob.create({
      data: {
        organizationId: context.organizationId,
        userId: context.userId,
        clientId: body.clientId || null,
        module: body.module,
        status: body.status,
        originalName: body.originalName.trim(),
        parserId: body.parserId || null,
        parserVersion: body.parserVersion || null,
        expectedTotal: body.expectedTotal ?? null,
        parsedTotal: body.parsedTotal ?? null,
        difference: body.difference ?? null,
        metadata: body.metadata ?? undefined,
        transactions: Array.isArray(body.transactions) && body.transactions.length ? {
          create: body.transactions.slice(0, 5000).map((item: { date: string; description?: string; amount?: number; type?: string; document?: string | null; category?: string | null; costCenter?: string | null; sourcePage?: number | null; metadata?: Record<string, unknown> }) => ({
            date: new Date(item.date),
            description: String(item.description || "Movimentação"),
            amount: Math.abs(Number(item.amount || 0)),
            type: item.type === "CREDIT" ? TransactionType.CREDIT : TransactionType.DEBIT,
            document: item.document || null,
            category: item.category || null,
            costCenter: item.costCenter || null,
            sourcePage: item.sourcePage ?? null,
            metadata: item.metadata ?? undefined,
          })),
        } : undefined,
      },
      select: { id: true, status: true, createdAt: true },
    });

    await prisma.auditLog.create({ data: { userId: context.userId, action: "IMPORT_CREATED", entity: "ImportJob", entityId: created.id, afterData: { module: body.module, status: body.status, originalName: body.originalName } } });
    return NextResponse.json({ importJob: created }, { status: 201 });
  } catch (error) {
    console.error("Erro ao salvar importação:", error);
    return NextResponse.json({ error: "Não foi possível salvar o processamento no banco." }, { status: 500 });
  }
}
