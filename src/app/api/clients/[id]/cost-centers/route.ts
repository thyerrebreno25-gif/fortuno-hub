import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getRolePermissions } from "@/modules/permissions/permissions";

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

function normalizeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
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
        { error: "Você não possui permissão para criar centros de custo." },
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

    const body = (await request.json()) as { name?: unknown; code?: unknown };
    const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
    const code = typeof body.code === "string" && body.code.trim() ? body.code.trim() : null;
    if (name.length < 2) {
      return NextResponse.json(
        { error: "Informe um nome com pelo menos 2 caracteres." },
        { status: 400 },
      );
    }

    const existing = await prisma.costCenter.findMany({
      where: { clientId },
      select: { id: true, name: true, code: true, active: true },
    });
    const duplicate = existing.find(
      (item) => normalizeName(item.name) === normalizeName(name),
    );
    if (duplicate) {
      const costCenter = duplicate.active
        ? duplicate
        : await prisma.costCenter.update({
            where: { id: duplicate.id },
            data: { active: true, code },
          });
      return NextResponse.json({ costCenter });
    }

    const costCenter = await prisma.costCenter.create({
      data: { clientId, name, code, active: true },
    });
    return NextResponse.json(
      { message: "Centro de custo criado com sucesso.", costCenter },
      { status: 201 },
    );
  } catch (error) {
    console.error("Erro ao criar centro de custo:", error);
    return NextResponse.json(
      { error: "Não foi possível criar o centro de custo." },
      { status: 500 },
    );
  }
}
