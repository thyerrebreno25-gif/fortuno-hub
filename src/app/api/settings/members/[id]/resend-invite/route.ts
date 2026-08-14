import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendMemberInviteEmail } from "@/modules/settings/email/member-invite-email";
import {
  buildMemberActivationUrl,
  getMemberInviteAppUrl,
  getMemberInviteRedirectTo,
} from "@/modules/settings/server/member-invite-link";
import {
  getSettingsMember,
  SETTINGS_ADMIN_ROLES,
} from "@/modules/settings/server/settings-auth";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type InviteRole = "ADMIN" | "MANAGER" | "OPERATOR" | "CLIENT";

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

    const accessAlreadyActivated = Boolean(
      authUser.email_confirmed_at ||
        authUser.confirmed_at ||
        authUser.last_sign_in_at ||
        authUser.factors?.some(
          (factor) =>
            factor.factor_type === "totp" && factor.status === "verified",
        ),
    );

    if (accessAlreadyActivated) {
      return NextResponse.json(
        { error: "Este colaborador já ativou o acesso." },
        { status: 409 },
      );
    }

    const appUrl = getMemberInviteAppUrl();
    const redirectTo = getMemberInviteRedirectTo(appUrl);
    const email = target.user.email.trim().toLowerCase();
    const name = target.user.name || target.user.email;

    const inviteResult = await admin.auth.admin.generateLink({
      type: "invite",
      email,
      options: {
        data: { name },
        ...(redirectTo ? { redirectTo } : {}),
      },
    });

    let linkType: "invite" | "recovery" = "invite";
    let actionUrl = buildMemberActivationUrl(
      appUrl,
      inviteResult.data?.properties,
    );

    if (inviteResult.error || !actionUrl) {
      const recoveryResult = await admin.auth.admin.generateLink({
        type: "recovery",
        email,
        options: {
          ...(redirectTo ? { redirectTo } : {}),
        },
      });

      if (recoveryResult.error) {
        return NextResponse.json(
          { error: recoveryResult.error.message },
          { status: 400 },
        );
      }

      linkType = "recovery";
      actionUrl = buildMemberActivationUrl(
        appUrl,
        recoveryResult.data?.properties,
      );
    }

    if (!actionUrl) {
      return NextResponse.json(
        { error: "Não foi possível gerar um novo link de ativação." },
        { status: 500 },
      );
    }

    const emailResult = await sendMemberInviteEmail({
      to: email,
      name,
      role: target.role as InviteRole,
      actionUrl,
    });

    if (!emailResult.sent) {
      return NextResponse.json(
        { error: `O novo link foi gerado, mas o e-mail falhou: ${emailResult.reason}` },
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
          delivery: "RESEND_CUSTOM_INVITE",
          linkType,
          emailId: emailResult.id || null,
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
