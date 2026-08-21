import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  deliverMemberInvite,
  isMemberAccessActivated,
  type MemberInviteRole,
} from "@/modules/settings/server/member-invite-delivery";
import {
  getSettingsMember,
  SETTINGS_ADMIN_ROLES,
} from "@/modules/settings/server/settings-auth";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const current = await getSettingsMember();

    if (!current) {
      return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    }

    if (!SETTINGS_ADMIN_ROLES.has(current.role)) {
      return NextResponse.json(
        { error: "Você não possui permissão para reenviar convites." },
        { status: 403 },
      );
    }

    const admin = createAdminClient();

    if (!admin) {
      return NextResponse.json(
        { error: "Os convites ainda não estão habilitados neste ambiente." },
        { status: 503 },
      );
    }

    const { id } = await context.params;
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
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!target) {
      return NextResponse.json(
        { error: "Colaborador não encontrado na organização." },
        { status: 404 },
      );
    }

    if (target.role === "MASTER") {
      return NextResponse.json(
        { error: "O convite do usuário MASTER não pode ser reenviado." },
        { status: 400 },
      );
    }

    const { data: authData, error: authError } =
      await admin.auth.admin.getUserById(target.user.id);
    const authUser = authData.user;

    if (authError || !authUser) {
      return NextResponse.json(
        { error: "Não foi possível localizar este convite no Supabase." },
        { status: 404 },
      );
    }

    if (isMemberAccessActivated(authUser)) {
      return NextResponse.json(
        { error: "Este colaborador já ativou o acesso." },
        { status: 409 },
      );
    }

    const email = target.user.email.trim().toLowerCase();
    const name = target.user.name || target.user.email;
    const delivery = await deliverMemberInvite({
      memberId: target.id,
      email,
      name,
      role: target.role as MemberInviteRole,
      reminder: true,
    });

    if (!delivery.sent) {
      return NextResponse.json(
        { error: `Não foi possível enviar o novo convite: ${delivery.reason}` },
        { status: 502 },
      );
    }

    await prisma.auditLog.create({
      data: {
        userId: current.userId,
        action: "ORGANIZATION_MEMBER_INVITE_RESENT",
        entity: "OrganizationMember",
        entityId: target.id,
        afterData: {
          name,
          email,
          role: target.role,
          delivery: "PERMANENT_CUSTOM_INVITE",
          linkType: delivery.linkType,
          emailId: delivery.emailId || null,
        },
      },
    });

    return NextResponse.json({
      message: `Novo convite enviado para ${email}.`,
    });
  } catch (error) {
    console.error("Erro ao reenviar convite:", error);
    return NextResponse.json(
      { error: "Não foi possível reenviar o convite." },
      { status: 500 },
    );
  }
}
