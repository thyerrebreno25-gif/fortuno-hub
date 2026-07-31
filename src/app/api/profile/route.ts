import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAccountMember } from "@/modules/account/server/account-auth";

export async function GET() {
  try {
    const member = await getAccountMember();

    if (!member) {
      return NextResponse.json(
        { error: "Sua sessão expirou ou o usuário não pertence a uma organização." },
        { status: 401 },
      );
    }

    return NextResponse.json({
      user: {
        id: member.user.id,
        name: member.user.name || member.user.email,
        email: member.user.email,
        role: member.role,
        createdAt: member.user.createdAt.toISOString(),
        updatedAt: member.user.updatedAt.toISOString(),
      },
      organization: {
        id: member.organization.id,
        name: member.organization.name,
        memberSince: member.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("Erro ao carregar perfil:", error);
    return NextResponse.json(
      { error: "Não foi possível carregar o perfil." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const member = await getAccountMember();

    if (!member) {
      return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    }

    const body = (await request.json()) as { name?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";

    if (name.length < 2) {
      return NextResponse.json(
        { error: "Informe um nome com pelo menos 2 caracteres." },
        { status: 400 },
      );
    }

    await prisma.$transaction(async (transaction) => {
      await transaction.user.update({
        where: { id: member.userId },
        data: { name },
      });

      await transaction.auditLog.create({
        data: {
          userId: member.userId,
          action: "PROFILE_UPDATED",
          entity: "User",
          entityId: member.userId,
          afterData: { name },
        },
      });
    });

    return NextResponse.json({
      message: "Perfil atualizado com sucesso.",
      name,
    });
  } catch (error) {
    console.error("Erro ao atualizar perfil:", error);
    return NextResponse.json(
      { error: "Não foi possível atualizar o perfil." },
      { status: 500 },
    );
  }
}
