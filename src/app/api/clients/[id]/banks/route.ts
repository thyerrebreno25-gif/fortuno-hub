import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const MANAGER_ROLES = new Set(["MASTER", "ADMIN", "MANAGER"]);

async function getMember() {
  const supabase = await createSupabaseClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;

  return prisma.organizationMember.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: {
      organizationId: true,
      role: true,
    },
  });
}

export async function PUT(
  request: Request,
  context: RouteContext,
) {
  try {
    const member = await getMember();

    if (!member) {
      return NextResponse.json(
        { error: "Sua sessão expirou." },
        { status: 401 },
      );
    }

    if (!MANAGER_ROLES.has(member.role)) {
      return NextResponse.json(
        { error: "Você não possui permissão para editar bancos." },
        { status: 403 },
      );
    }

    const { id: clientId } = await context.params;

    const client = await prisma.client.findFirst({
      where: {
        id: clientId,
        organizationId: member.organizationId,
      },
      select: { id: true },
    });

    if (!client) {
      return NextResponse.json(
        { error: "Cliente não encontrado." },
        { status: 404 },
      );
    }

    const body = (await request.json()) as { banks?: unknown };

    if (!Array.isArray(body.banks)) {
      return NextResponse.json(
        { error: "A lista de bancos é inválida." },
        { status: 400 },
      );
    }

    const parsed = body.banks.map((item, index) => {
      const row = item as {
        bankName?: unknown;
        bankCode?: unknown;
        agency?: unknown;
        account?: unknown;
        accountType?: unknown;
        active?: unknown;
      };

      const bankName =
        typeof row.bankName === "string" ? row.bankName.trim() : "";
      const bankCode =
        typeof row.bankCode === "string" && row.bankCode.trim()
          ? row.bankCode.trim()
          : null;
      const agency =
        typeof row.agency === "string" && row.agency.trim()
          ? row.agency.trim()
          : null;
      const account =
        typeof row.account === "string" ? row.account.trim() : "";
      const accountType =
        typeof row.accountType === "string"
          ? row.accountType.trim()
          : "";
      const active =
        typeof row.active === "boolean" ? row.active : true;

      if (bankName.length < 2) {
        throw new Error(`Informe o banco da conta ${index + 1}.`);
      }

      if (!account) {
        throw new Error(`Informe o número da conta ${index + 1}.`);
      }

      if (!accountType) {
        throw new Error(`Informe o tipo da conta ${index + 1}.`);
      }

      return {
        clientId,
        bankName,
        bankCode,
        agency,
        account,
        accountType,
        active,
      };
    });

    const banks = await prisma.$transaction(async (tx) => {
      await tx.clientBank.deleteMany({
        where: { clientId },
      });

      if (parsed.length) {
        await tx.clientBank.createMany({
          data: parsed,
        });
      }

      return tx.clientBank.findMany({
        where: { clientId },
        orderBy: { bankName: "asc" },
      });
    });

    return NextResponse.json({
      message: "Contas bancárias salvas com sucesso.",
      banks,
    });
  } catch (error) {
    console.error("Erro ao salvar bancos:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível salvar os bancos.",
      },
      { status: 500 },
    );
  }
}
