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
    where: {
      userId: user.id,
    },
    orderBy: {
      createdAt: "asc",
    },
    select: {
      organizationId: true,
      role: true,
    },
  });
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const member = await getMember();

    if (!member) {
      return NextResponse.json(
        {
          error: "Sua sessão expirou.",
        },
        {
          status: 401,
        },
      );
    }

    if (!MANAGER_ROLES.has(member.role)) {
      return NextResponse.json(
        {
          error: "Você não possui permissão para editar cartões.",
        },
        {
          status: 403,
        },
      );
    }

    const { id: clientId } = await context.params;

    const client = await prisma.client.findFirst({
      where: {
        id: clientId,
        organizationId: member.organizationId,
      },
      select: {
        id: true,
      },
    });

    if (!client) {
      return NextResponse.json(
        {
          error: "Cliente não encontrado.",
        },
        {
          status: 404,
        },
      );
    }

    const body = (await request.json()) as {
      cards?: unknown;
    };

    if (!Array.isArray(body.cards)) {
      return NextResponse.json(
        {
          error: "A lista de cartões é inválida.",
        },
        {
          status: 400,
        },
      );
    }

    const parsed = body.cards.map((item, index) => {
      const row = item as Record<string, unknown>;

      const brand =
        typeof row.brand === "string" ? normalizeText(row.brand) : "";

      const active =
        typeof row.active === "boolean" ? row.active : true;

      if (brand.length < 2) {
        throw new Error(
          `Informe a bandeira do cartão ${index + 1}.`,
        );
      }

      return {
        clientId,
        brand,
        active,
      };
    });

    const identities = parsed.map((card) => card.brand);

    if (new Set(identities).size !== identities.length) {
      return NextResponse.json(
        {
          error:
            "Existe mais de um cartão com a mesma bandeira para este cliente.",
        },
        {
          status: 409,
        },
      );
    }

    const cards = await prisma.$transaction(async (transaction) => {
      await transaction.clientCard.deleteMany({
        where: {
          clientId,
        },
      });

      if (parsed.length > 0) {
        await transaction.clientCard.createMany({
          data: parsed,
        });
      }

      return transaction.clientCard.findMany({
        where: {
          clientId,
        },
        orderBy: {
          brand: "asc",
        },
      });
    });

    return NextResponse.json({
      message: "Cartões salvos e vinculados à leitura de faturas.",
      cards,
    });
  } catch (error) {
    console.error("Erro ao salvar cartões:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível salvar os cartões.",
      },
      {
        status: 500,
      },
    );
  }
}