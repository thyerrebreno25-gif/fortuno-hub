import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSettingsMember,
  SETTINGS_ADMIN_ROLES,
} from "@/modules/settings/server/settings-auth";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const ALLOWED_ROLES = new Set([
  "ADMIN",
  "MANAGER",
  "OPERATOR",
  "CLIENT",
]);

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const current = await getSettingsMember();

    if (!current) {
      return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    }

    if (!SETTINGS_ADMIN_ROLES.has(current.role)) {
      return NextResponse.json(
        { error: "Você não possui permissão para alterar usuários." },
        { status: 403 },
      );
    }

    const { id } = await context.params;
    const body = (await request.json()) as {
      role?: unknown;
      name?: unknown;
    };

    const role =
      typeof body.role === "string" && ALLOWED_ROLES.has(body.role)
        ? body.role
        : null;
    const name = typeof body.name === "string" ? body.name.trim() : "";

    const target = await prisma.organizationMember.findFirst({
      where: {
        id,
        organizationId: current.organizationId,
      },
      select: {
        id: true,
        userId: true,
        role: true,
      },
    });

    if (!target) {
      return NextResponse.json(
        { error: "Usuário não encontrado na organização." },
        { status: 404 },
      );
    }

    if (target.role === "MASTER") {
      return NextResponse.json(
        { error: "O perfil MASTER não pode ser alterado nesta tela." },
        { status: 400 },
      );
    }

    await prisma.$transaction(async (transaction) => {
      if (role) {
        await transaction.organizationMember.update({
          where: { id },
          data: {
            role: role as "ADMIN" | "MANAGER" | "OPERATOR" | "CLIENT",
          },
        });
      }

      if (name.length >= 2) {
        await transaction.user.update({
          where: { id: target.userId },
          data: { name },
        });
      }

      await transaction.auditLog.create({
        data: {
          userId: current.userId,
          action: "ORGANIZATION_MEMBER_UPDATED",
          entity: "OrganizationMember",
          entityId: id,
          afterData: {
            role: role || undefined,
            name: name || undefined,
          },
        },
      });
    });

    return NextResponse.json({ message: "Usuário atualizado com sucesso." });
  } catch (error) {
    console.error("Erro ao atualizar usuário:", error);
    return NextResponse.json(
      { error: "Não foi possível atualizar o usuário." },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const current = await getSettingsMember();

    if (!current) {
      return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    }

    if (!SETTINGS_ADMIN_ROLES.has(current.role)) {
      return NextResponse.json(
        { error: "Você não possui permissão para remover usuários." },
        { status: 403 },
      );
    }

    const { id } = await context.params;

    if (id === current.id) {
      return NextResponse.json(
        { error: "Você não pode remover o próprio acesso." },
        { status: 400 },
      );
    }

    const target = await prisma.organizationMember.findFirst({
      where: {
        id,
        organizationId: current.organizationId,
      },
      select: {
        id: true,
        role: true,
        user: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    });

    if (!target) {
      return NextResponse.json(
        { error: "Usuário não encontrado na organização." },
        { status: 404 },
      );
    }

    if (target.role === "MASTER") {
      return NextResponse.json(
        { error: "O usuário MASTER não pode ser removido." },
        { status: 400 },
      );
    }

    await prisma.$transaction(async (transaction) => {
      await transaction.organizationMember.delete({ where: { id } });

      await transaction.auditLog.create({
        data: {
          userId: current.userId,
          action: "ORGANIZATION_MEMBER_REMOVED",
          entity: "OrganizationMember",
          entityId: id,
          beforeData: {
            name: target.user.name,
            email: target.user.email,
            role: target.role,
          },
        },
      });
    });

    return NextResponse.json({ message: "Acesso removido da organização." });
  } catch (error) {
    console.error("Erro ao remover usuário:", error);
    return NextResponse.json(
      { error: "Não foi possível remover o usuário." },
      { status: 500 },
    );
  }
}
