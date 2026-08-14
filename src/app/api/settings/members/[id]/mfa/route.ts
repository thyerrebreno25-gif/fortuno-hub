import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getSettingsMember,
  SETTINGS_ADMIN_ROLES,
} from "@/modules/settings/server/settings-auth";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const current = await getSettingsMember();

    if (!current) {
      return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    }

    if (!SETTINGS_ADMIN_ROLES.has(current.role)) {
      return NextResponse.json(
        { error: "Você não possui permissão para redefinir autenticadores." },
        { status: 403 },
      );
    }

    const { id } = await context.params;
    const target = await prisma.organizationMember.findFirst({
      where: { id, organizationId: current.organizationId },
      select: {
        role: true,
        userId: true,
        user: { select: { name: true, email: true } },
      },
    });

    if (!target) {
      return NextResponse.json(
        { error: "Colaborador não encontrado na organização." },
        { status: 404 },
      );
    }

    if (target.role === "MASTER" && target.userId !== current.userId) {
      return NextResponse.json(
        {
          error:
            "O autenticador do perfil MASTER só pode ser alterado pelo próprio usuário.",
        },
        { status: 403 },
      );
    }

    const admin = createAdminClient();

    if (!admin) {
      return NextResponse.json(
        { error: "A administração do Supabase não está configurada." },
        { status: 503 },
      );
    }

    const { data, error: listError } =
      await admin.auth.admin.mfa.listFactors({ userId: target.userId });

    if (listError) throw listError;

    const totpFactors = data.factors.filter(
      (factor) => factor.factor_type === "totp",
    );

    for (const factor of totpFactors) {
      const { error: deleteError } =
        await admin.auth.admin.mfa.deleteFactor({
          userId: target.userId,
          id: factor.id,
        });

      if (deleteError) throw deleteError;
    }

    if (totpFactors.length > 0) {
      await prisma.auditLog.create({
        data: {
          userId: current.userId,
          action: "USER_MFA_RESET",
          entity: "User",
          entityId: target.userId,
          afterData: {
            name: target.user.name,
            email: target.user.email,
            removedFactors: totpFactors.length,
          },
        },
      });
    }

    return NextResponse.json({
      message:
        totpFactors.length > 0
          ? `Autenticador de ${target.user.name || target.user.email} redefinido. No próximo login será exibido um novo QR Code.`
          : "Este colaborador ainda não possuía um autenticador configurado.",
    });
  } catch (error) {
    console.error("Erro ao redefinir autenticador:", error);
    return NextResponse.json(
      { error: "Não foi possível redefinir o autenticador." },
      { status: 500 },
    );
  }
}
