import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getSettingsMember,
  SETTINGS_ADMIN_ROLES,
} from "@/modules/settings/server/settings-auth";

function cleanDocument(value: unknown): string {
  return typeof value === "string" ? value.replace(/\D/g, "") : "";
}

export async function GET() {
  try {
    const member = await getSettingsMember();

    if (!member) {
      return NextResponse.json(
        { error: "Sua sessão expirou ou você não pertence a uma organização." },
        { status: 401 },
      );
    }

    const [organization, members, counts, audit] = await Promise.all([
      prisma.organization.findUnique({
        where: { id: member.organizationId },
        select: {
          id: true,
          name: true,
          document: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.organizationMember.findMany({
        where: { organizationId: member.organizationId },
        orderBy: [{ role: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          role: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              updatedAt: true,
            },
          },
        },
      }),
      Promise.all([
        prisma.client.count({
          where: { organizationId: member.organizationId, active: true },
        }),
        prisma.importJob.count({
          where: { organizationId: member.organizationId },
        }),
        prisma.supportTicket.count({
          where: {
            organizationId: member.organizationId,
            status: { in: ["OPEN", "IN_PROGRESS"] },
          },
        }),
        prisma.onboarding.count({
          where: {
            organizationId: member.organizationId,
            status: { in: ["OPEN", "IN_PROGRESS"] },
          },
        }),
      ]),
      prisma.auditLog.findMany({
        where: {
          user: {
            memberships: {
              some: { organizationId: member.organizationId },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          action: true,
          entity: true,
          entityId: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      }),
    ]);

    if (!organization) {
      return NextResponse.json(
        { error: "Organização não encontrada." },
        { status: 404 },
      );
    }

    const authUsers = new Map<
      string,
      {
        confirmedAt: string | null;
        lastSignInAt: string | null;
        mfaConfigured: boolean;
      }
    >();
    const admin = createAdminClient();

    if (admin) {
      const { data: authData, error: authError } =
        await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });

      if (authError) {
        console.warn("Não foi possível consultar o status dos acessos:", authError);
      } else {
        for (const authUser of authData.users) {
          authUsers.set(authUser.id, {
            confirmedAt:
              authUser.email_confirmed_at || authUser.confirmed_at || null,
            lastSignInAt: authUser.last_sign_in_at || null,
            mfaConfigured: Boolean(
              authUser.factors?.some(
                (factor) =>
                  factor.factor_type === "totp" && factor.status === "verified",
              ),
            ),
          });
        }
      }
    }

    return NextResponse.json({
      currentUser: {
        id: member.user.id,
        name: member.user.name || member.user.email,
        email: member.user.email,
        role: member.role,
        canAdminister: SETTINGS_ADMIN_ROLES.has(member.role),
      },
      organization: {
        ...organization,
        createdAt: organization.createdAt.toISOString(),
        updatedAt: organization.updatedAt.toISOString(),
      },
      members: members.map((item) => {
        const authStatus = authUsers.get(item.user.id);
        const accessStatus = !admin || !authStatus
          ? "UNKNOWN"
          : authStatus.mfaConfigured
            ? "CONFIGURED"
            : authStatus.confirmedAt || authStatus.lastSignInAt
              ? "ACTIVATED"
              : "PENDING";

        return {
          id: item.id,
          role: item.role,
          createdAt: item.createdAt.toISOString(),
          accessStatus,
          accessConfiguredAt:
            accessStatus === "CONFIGURED"
              ? authStatus?.confirmedAt || authStatus?.lastSignInAt || null
              : null,
          lastSignInAt: authStatus?.lastSignInAt || null,
          mfaConfigured: authStatus?.mfaConfigured || false,
          user: {
            ...item.user,
            name: item.user.name || item.user.email,
            updatedAt: item.user.updatedAt.toISOString(),
          },
        };
      }),
      summary: {
        activeClients: counts[0],
        imports: counts[1],
        openTickets: counts[2],
        activeOnboardings: counts[3],
      },
      audit: audit.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
        user: {
          id: item.user.id,
          name: item.user.name || item.user.email,
          email: item.user.email,
        },
      })),
      integrationStatus: {
        supabase: Boolean(
          process.env.NEXT_PUBLIC_SUPABASE_URL &&
            process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        ),
        userInvites: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
        database: true,
      },
    });
  } catch (error) {
    console.error("Erro ao carregar configurações:", error);
    return NextResponse.json(
      { error: "Não foi possível carregar as configurações." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const member = await getSettingsMember();

    if (!member) {
      return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    }

    if (!SETTINGS_ADMIN_ROLES.has(member.role)) {
      return NextResponse.json(
        { error: "Você não possui permissão para alterar a organização." },
        { status: 403 },
      );
    }

    const body = (await request.json()) as {
      organizationName?: unknown;
      document?: unknown;
      userName?: unknown;
    };

    const organizationName =
      typeof body.organizationName === "string"
        ? body.organizationName.trim()
        : "";
    const document = cleanDocument(body.document);
    const userName =
      typeof body.userName === "string" ? body.userName.trim() : "";

    if (organizationName.length < 3) {
      return NextResponse.json(
        { error: "Informe um nome de organização válido." },
        { status: 400 },
      );
    }

    if (document && document.length !== 14) {
      return NextResponse.json(
        { error: "O CNPJ deve conter 14 números." },
        { status: 400 },
      );
    }

    if (document) {
      const duplicate = await prisma.organization.findFirst({
        where: {
          document,
          id: { not: member.organizationId },
        },
        select: { id: true },
      });

      if (duplicate) {
        return NextResponse.json(
          { error: "Este CNPJ já está vinculado a outra organização." },
          { status: 409 },
        );
      }
    }

    await prisma.$transaction(async (transaction) => {
      await transaction.organization.update({
        where: { id: member.organizationId },
        data: {
          name: organizationName,
          document: document || null,
        },
      });

      if (userName.length >= 2) {
        await transaction.user.update({
          where: { id: member.userId },
          data: { name: userName },
        });
      }

      await transaction.auditLog.create({
        data: {
          userId: member.userId,
          action: "SETTINGS_UPDATED",
          entity: "Organization",
          entityId: member.organizationId,
          afterData: {
            organizationName,
            document: document || null,
            userName: userName || undefined,
          },
        },
      });
    });

    return NextResponse.json({ message: "Configurações salvas com sucesso." });
  } catch (error) {
    console.error("Erro ao salvar configurações:", error);
    return NextResponse.json(
      { error: "Não foi possível salvar as configurações." },
      { status: 500 },
    );
  }
}
