import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getRolePermissions } from "@/modules/permissions/permissions";

async function getMember() {
  const supabase = await createSupabaseClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  return prisma.organizationMember.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: {
      organizationId: true,
      role: true,
    },
  });
}

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

export async function POST(request: Request) {
  try {
    const member = await getMember();

    if (!member) {
      return NextResponse.json(
        { error: "Sua sessão expirou." },
        { status: 401 },
      );
    }

    const permissions = await getRolePermissions(
      member.organizationId,
      member.role,
    );

    if (!permissions.CLIENTS.canEdit) {
      return NextResponse.json(
        { error: "Você não possui permissão para criar categorias." },
        { status: 403 },
      );
    }

    const body = (await request.json()) as {
      name?: unknown;
      code?: unknown;
      parentId?: unknown;
    };

    const name =
      typeof body.name === "string" ? body.name.trim() : "";
    const code =
      typeof body.code === "string" && body.code.trim()
        ? body.code.trim()
        : null;
    const parentId =
      typeof body.parentId === "string" && body.parentId
        ? body.parentId
        : null;

    if (name.length < 2) {
      return NextResponse.json(
        { error: "Informe um nome com pelo menos 2 caracteres." },
        { status: 400 },
      );
    }

    if (parentId) {
      const parent = await prisma.category.findFirst({
        where: {
          id: parentId,
          organizationId: member.organizationId,
          parentId: null,
          active: true,
        },
        select: { id: true },
      });

      if (!parent) {
        return NextResponse.json(
          { error: "Categoria principal inválida." },
          { status: 400 },
        );
      }
    }

    const normalizedName = normalizeName(name);

    const duplicate = await prisma.category.findFirst({
      where: {
        organizationId: member.organizationId,
        parentId,
        normalizedName,
      },
      select: { id: true },
    });

    if (duplicate) {
      return NextResponse.json(
        {
          error: parentId
            ? "Essa subcategoria já existe."
            : "Essa categoria já existe.",
        },
        { status: 409 },
      );
    }

    const category = await prisma.category.create({
      data: {
        organizationId: member.organizationId,
        parentId,
        name,
        normalizedName,
        code,
        active: true,
      },
      include: {
        children: {
          where: { active: true },
          orderBy: { name: "asc" },
        },
      },
    });

    return NextResponse.json(
      {
        message: parentId
          ? "Subcategoria criada com sucesso."
          : "Categoria criada com sucesso.",
        category,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Erro ao criar categoria:", error);

    return NextResponse.json(
      { error: "Não foi possível criar a categoria." },
      { status: 500 },
    );
  }
}
