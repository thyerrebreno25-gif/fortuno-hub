import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const MANAGER_ROLES = new Set([
  "MASTER",
  "ADMIN",
  "MANAGER",
]);

const MAPPING_TYPES = new Set([
  "SALES_REVENUE",
  "MDR_FEES",
  "ADVANCE_FEES",
  "MACHINE_RENTAL_ADJUSTMENTS",
  "SALE_CANCELLATION",
  "REFUNDS_CREDITS",
]);

async function getMember() {
  const supabase = await createSupabaseClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

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

export async function PUT(
  request: Request,
  context: RouteContext,
) {
  try {
    const member = await getMember();

    if (!member) {
      return NextResponse.json(
        {
          error:
            "Sua sessão expirou ou você não pertence a uma organização.",
        },
        {
          status: 401,
        },
      );
    }

    if (!MANAGER_ROLES.has(member.role)) {
      return NextResponse.json(
        {
          error:
            "Você não possui permissão para editar categorias.",
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
      mappings?: unknown;
    };

    if (!Array.isArray(body.mappings)) {
      return NextResponse.json(
        {
          error: "Os mapeamentos enviados são inválidos.",
        },
        {
          status: 400,
        },
      );
    }

    const parsed = body.mappings.map((item) => {
      const row = item as {
        mappingType?: unknown;
        categoryId?: unknown;
        subcategoryId?: unknown;
      };

      if (
        typeof row.mappingType !== "string" ||
        !MAPPING_TYPES.has(row.mappingType)
      ) {
        throw new Error("Tipo de mapeamento inválido.");
      }

      return {
        mappingType: row.mappingType as
          | "SALES_REVENUE"
          | "MDR_FEES"
          | "ADVANCE_FEES"
          | "MACHINE_RENTAL_ADJUSTMENTS"
          | "SALE_CANCELLATION"
          | "REFUNDS_CREDITS",
        categoryId:
          typeof row.categoryId === "string" &&
          row.categoryId.length > 0
            ? row.categoryId
            : null,
        subcategoryId:
          typeof row.subcategoryId === "string" &&
          row.subcategoryId.length > 0
            ? row.subcategoryId
            : null,
      };
    });

    const selectedCategoryIds = parsed.flatMap((mapping) => [
      ...(mapping.categoryId ? [mapping.categoryId] : []),
      ...(mapping.subcategoryId
        ? [mapping.subcategoryId]
        : []),
    ]);

    const categories = await prisma.category.findMany({
      where: {
        organizationId: member.organizationId,
        id: {
          in: selectedCategoryIds,
        },
      },
      select: {
        id: true,
        parentId: true,
      },
    });

    const categoryMap = new Map(
      categories.map((category) => [category.id, category]),
    );

    for (const mapping of parsed) {
      if (!mapping.categoryId) {
        continue;
      }

      const category = categoryMap.get(mapping.categoryId);

      if (!category || category.parentId) {
        return NextResponse.json(
          {
            error:
              "Uma das categorias selecionadas é inválida.",
          },
          {
            status: 400,
          },
        );
      }

      if (mapping.subcategoryId) {
        const subcategory = categoryMap.get(
          mapping.subcategoryId,
        );

        if (
          !subcategory ||
          subcategory.parentId !== mapping.categoryId
        ) {
          return NextResponse.json(
            {
              error:
                "Uma das subcategorias não pertence à categoria selecionada.",
            },
            {
              status: 400,
            },
          );
        }
      }
    }

    const mappings = await prisma.$transaction(async (tx) => {
      for (const mapping of parsed) {
        if (!mapping.categoryId) {
          await tx.clientCategoryMapping.deleteMany({
            where: {
              clientId,
              mappingType: mapping.mappingType,
            },
          });

          continue;
        }

        await tx.clientCategoryMapping.upsert({
          where: {
            clientId_mappingType: {
              clientId,
              mappingType: mapping.mappingType,
            },
          },
          update: {
            categoryId: mapping.categoryId,
            subcategoryId: mapping.subcategoryId,
          },
          create: {
            clientId,
            mappingType: mapping.mappingType,
            categoryId: mapping.categoryId,
            subcategoryId: mapping.subcategoryId,
          },
        });
      }

      return tx.clientCategoryMapping.findMany({
        where: {
          clientId,
        },
        include: {
          category: true,
          subcategory: true,
        },
      });
    });

    return NextResponse.json({
      message: "Categorias salvas com sucesso.",
      mappings,
    });
  } catch (error) {
    console.error("Erro ao salvar categorias:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível salvar as categorias.",
      },
      {
        status: 500,
      },
    );
  }
}
