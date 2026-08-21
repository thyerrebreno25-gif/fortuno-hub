import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isMemberAccessActivated,
} from "@/modules/settings/server/member-invite-delivery";
import { createFreshMemberActivationSession } from "@/modules/settings/server/member-invite-session";
import {
  hashMemberInviteToken,
  isValidMemberInviteToken,
} from "@/modules/settings/server/member-invite-token";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { token?: unknown };
    const token = typeof body.token === "string" ? body.token.trim() : "";

    if (!isValidMemberInviteToken(token)) {
      return NextResponse.json(
        {
          error: "Este convite é inválido.",
          code: "INVALID_INVITE",
        },
        { status: 400 },
      );
    }

    const invite = await prisma.organizationMemberInviteToken.findUnique({
      where: {
        tokenHash: hashMemberInviteToken(token),
      },
      select: {
        member: {
          select: {
            id: true,
            user: {
              select: {
                id: true,
                email: true,
              },
            },
          },
        },
      },
    });

    if (!invite) {
      return NextResponse.json(
        {
          error: "Este convite é inválido.",
          code: "INVALID_INVITE",
        },
        { status: 400 },
      );
    }

    const admin = createAdminClient();

    if (!admin) {
      return NextResponse.json(
        { error: "A ativação de acesso não está configurada neste ambiente." },
        { status: 503 },
      );
    }

    const { data: authData, error: authError } =
      await admin.auth.admin.getUserById(invite.member.user.id);

    if (authError || !authData.user) {
      return NextResponse.json(
        {
          error: "Não foi possível localizar este acesso.",
          code: "INVALID_INVITE",
        },
        { status: 400 },
      );
    }

    if (isMemberAccessActivated(authData.user)) {
      return NextResponse.json(
        {
          error: "Este acesso já foi ativado. Entre com seu e-mail e senha.",
          code: "ACCESS_ALREADY_ACTIVATED",
        },
        { status: 409 },
      );
    }

    const activation = await createFreshMemberActivationSession(
      admin,
      invite.member.user.email.trim().toLowerCase(),
    );

    if (!activation.created) {
      return NextResponse.json(
        { error: activation.reason },
        { status: 502 },
      );
    }

    return NextResponse.json({
      activationUrl: activation.activationUrl,
    });
  } catch (error) {
    console.error("Erro ao validar convite permanente:", error);

    return NextResponse.json(
      { error: "Não foi possível validar este convite." },
      { status: 500 },
    );
  }
}
