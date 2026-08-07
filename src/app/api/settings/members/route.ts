import { NextResponse } from "next/server";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import {
  getSettingsMember,
  SETTINGS_ADMIN_ROLES,
} from "@/modules/settings/server/settings-auth";
import { sendMemberInviteEmail } from "@/modules/settings/email/member-invite-email";

const ALLOWED_ROLES = new Set([
  "ADMIN",
  "MANAGER",
  "OPERATOR",
  "CLIENT",
]);

type AllowedRole =
  | "ADMIN"
  | "MANAGER"
  | "OPERATOR"
  | "CLIENT";

function getAppUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    ""
  )
    .trim()
    .replace(/\/+$/, "");
}

export async function POST(request: Request) {
  try {
    const member = await getSettingsMember();

    if (!member) {
      return NextResponse.json(
        { error: "Sessão inválida." },
        { status: 401 },
      );
    }

    if (!SETTINGS_ADMIN_ROLES.has(member.role)) {
      return NextResponse.json(
        {
          error:
            "Você não possui permissão para convidar usuários.",
        },
        { status: 403 },
      );
    }

    const serviceRoleKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL;

    if (!serviceRoleKey || !supabaseUrl) {
      return NextResponse.json(
        {
          error:
            "Convites ainda não estão habilitados. Configure SUPABASE_SERVICE_ROLE_KEY e NEXT_PUBLIC_SUPABASE_URL.",
        },
        { status: 503 },
      );
    }

    const body = (await request.json()) as {
      name?: unknown;
      email?: unknown;
      role?: unknown;
    };

    const name =
      typeof body.name === "string"
        ? body.name.trim()
        : "";

    const email =
      typeof body.email === "string"
        ? body.email.trim().toLowerCase()
        : "";

    const role: AllowedRole =
      typeof body.role === "string" &&
      ALLOWED_ROLES.has(body.role)
        ? (body.role as AllowedRole)
        : "OPERATOR";

    if (name.length < 2) {
      return NextResponse.json(
        { error: "Informe o nome do usuário." },
        { status: 400 },
      );
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: "Informe um e-mail válido." },
        { status: 400 },
      );
    }

    const existingMember =
      await prisma.organizationMember.findFirst({
        where: {
          organizationId: member.organizationId,
          user: { email },
        },
        select: { id: true },
      });

    if (existingMember) {
      return NextResponse.json(
        {
          error:
            "Este usuário já pertence à organização.",
        },
        { status: 409 },
      );
    }

    const admin = createSupabaseAdmin(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      },
    );

    const appUrl = getAppUrl();
    const redirectTo = appUrl
      ? `${appUrl}/login`
      : undefined;

    const {
      data: inviteData,
      error: inviteError,
    } = await admin.auth.admin.generateLink({
      type: "invite",
      email,
      options: {
        data: { name },
        ...(redirectTo
          ? { redirectTo }
          : {}),
      },
    });

    let authUser = inviteData?.user ?? null;
    let actionUrl =
      inviteData?.properties?.action_link ?? "";

    if (inviteError) {
      const {
        data: listData,
        error: listError,
      } = await admin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });

      if (listError) {
        throw inviteError;
      }

      authUser =
        listData.users.find(
          (item) =>
            item.email?.toLowerCase() === email,
        ) ?? null;

      if (!authUser) {
        return NextResponse.json(
          { error: inviteError.message },
          { status: 400 },
        );
      }

      const {
        data: recoveryData,
        error: recoveryError,
      } = await admin.auth.admin.generateLink({
        type: "recovery",
        email,
        options: {
          ...(redirectTo
            ? { redirectTo }
            : {}),
        },
      });

      if (!recoveryError) {
        actionUrl =
          recoveryData?.properties?.action_link ??
          actionUrl;
      }
    }

    if (!authUser?.id) {
      return NextResponse.json(
        {
          error:
            "Não foi possível identificar o usuário convidado.",
        },
        { status: 500 },
      );
    }

    const created =
      await prisma.$transaction(
        async (transaction) => {
          const user =
            await transaction.user.upsert({
              where: {
                id: authUser!.id,
              },
              update: {
                email,
                name,
              },
              create: {
                id: authUser!.id,
                email,
                name,
              },
            });

          const membership =
            await transaction.organizationMember.create(
              {
                data: {
                  organizationId:
                    member.organizationId,
                  userId: user.id,
                  role,
                },
              },
            );

          await transaction.auditLog.create({
            data: {
              userId: member.userId,
              action:
                "ORGANIZATION_MEMBER_INVITED",
              entity: "OrganizationMember",
              entityId: membership.id,
              afterData: {
                name,
                email,
                role,
                delivery:
                  "RESEND_CUSTOM_INVITE",
              },
            },
          });

          return membership;
        },
      );

    const emailResult =
      await sendMemberInviteEmail({
        to: email,
        name,
        role,
        actionUrl,
      });

    if (!emailResult.sent) {
      console.error(
        "Usuário criado, mas convite por e-mail falhou:",
        emailResult.reason,
      );

      return NextResponse.json(
        {
          id: created.id,
          emailSent: false,
          emailError: emailResult.reason,
          message:
            "Usuário criado e vinculado à organização, mas o e-mail de acesso não pôde ser enviado.",
        },
        { status: 201 },
      );
    }

    return NextResponse.json(
      {
        id: created.id,
        emailSent: true,
        message:
          "Usuário criado, vinculado à organização e convite enviado por e-mail.",
      },
      { status: 201 },
    );
  } catch (error) {
    console.error(
      "Erro ao convidar usuário:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Não foi possível convidar o usuário.",
      },
      { status: 500 },
    );
  }
}