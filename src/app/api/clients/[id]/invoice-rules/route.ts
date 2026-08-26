import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getRolePermissions } from "@/modules/permissions/permissions";
import { normalizeInvoiceMerchant } from "@/modules/card-invoices/category-learning";

type RouteContext = {
  params: Promise<{ id: string }>;
};

async function getMember() {
  const supabase = await createSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return prisma.organizationMember.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true, role: true },
  });
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const member = await getMember();
    if (!member) {
      return NextResponse.json({ error: "Sua sessão expirou." }, { status: 401 });
    }
    const permissions = await getRolePermissions(
      member.organizationId,
      member.role,
    );
    if (!permissions.CLIENTS.canEdit) {
      return NextResponse.json(
        { error: "Você não possui permissão para salvar regras do cliente." },
        { status: 403 },
      );
    }

    const { id: clientId } = await context.params;
    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: member.organizationId },
      select: { id: true },
    });
    if (!client) {
      return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
    }

    const body = (await request.json()) as {
      description?: unknown;
      category?: unknown;
      costCenter?: unknown;
    };
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const category = typeof body.category === "string" ? body.category.trim() : "";
    const costCenter = typeof body.costCenter === "string" && body.costCenter.trim()
      ? body.costCenter.trim()
      : null;
    const normalizedDescription = normalizeInvoiceMerchant(description);
    if (!normalizedDescription || !category) {
      return NextResponse.json(
        { error: "Descrição e categoria são obrigatórias." },
        { status: 400 },
      );
    }

    if (costCenter) {
      const validCostCenter = await prisma.costCenter.findFirst({
        where: { clientId, name: costCenter, active: true },
        select: { id: true },
      });
      if (!validCostCenter) {
        return NextResponse.json(
          { error: "Centro de custo inválido para este cliente." },
          { status: 400 },
        );
      }
    }

    const current = await prisma.categoryRule.findFirst({
      where: {
        clientId,
        module: "CREDIT_CARD_INVOICE",
        normalizedDescription,
      },
      select: { id: true },
    });
    const rule = current
      ? await prisma.categoryRule.update({
          where: { id: current.id },
          data: { category, costCenter, confidence: 100 },
        })
      : await prisma.categoryRule.create({
          data: {
            clientId,
            module: "CREDIT_CARD_INVOICE",
            normalizedDescription,
            category,
            costCenter,
            confidence: 100,
          },
        });

    return NextResponse.json({ message: "Regra aprendida com sucesso.", rule });
  } catch (error) {
    console.error("Erro ao salvar regra de fatura:", error);
    return NextResponse.json(
      { error: "Não foi possível salvar o aprendizado da fatura." },
      { status: 500 },
    );
  }
}
