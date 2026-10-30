import { z } from "zod";
import { acquirerMappingTypes } from "@/modules/acquirers/category-mapping";
import { saveAcquirerCategory } from "@/modules/clients/save-acquirer-category";
import { NextResponse } from "next/server";
import { syncClientCategories } from "@/modules/clients/ca-categories";
import { prisma } from "@/lib/prisma";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getRolePermissions } from "@/modules/permissions/permissions";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

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
      userId: true,
      organizationId: true,
      role: true,
    },
  });
}

export async function GET(_request:Request,context:RouteContext){
  const member=await getMember();
  if(!member)return NextResponse.json({error:"Sua sessão expirou."},{status:401});
  const permissions=await getRolePermissions(member.organizationId,member.role);
  if(!permissions.CLIENTS.canView)return NextResponse.json({error:"Sem permissão para consultar categorias."},{status:403});
  const {id:clientId}=await context.params;
  if(!await prisma.client.findFirst({where:{id:clientId,organizationId:member.organizationId},select:{id:true}}))return NextResponse.json({error:"Cliente não encontrado."},{status:404});
  try{return NextResponse.json({categories:await syncClientCategories(member.organizationId,clientId),source:"CONTA_AZUL",clientId});}
  catch{return NextResponse.json({error:"Não foi possível consultar as categorias do CA deste cliente. Confira sua conexão e tente atualizar."},{status:502});}
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

    const permissions = await getRolePermissions(
      member.organizationId,
      member.role,
    );

    if (!permissions.CLIENTS.canEdit) {
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

    const submittedMappingTypes = parsed.map(
      (mapping) => mapping.mappingType,
    );

    if (new Set(submittedMappingTypes).size !== submittedMappingTypes.length) {
      return NextResponse.json(
        {
          error: "O mesmo tipo de categoria foi enviado mais de uma vez.",
        },
        {
          status: 400,
        },
      );
    }

    const selectedCategoryIds = parsed.flatMap((mapping) => [
      ...(mapping.categoryId ? [mapping.categoryId] : []),
      ...(mapping.subcategoryId
        ? [mapping.subcategoryId]
        : []),
    ]);

    const categories = await prisma.category.findMany({
      where: {
        organizationId: member.organizationId,
        sourceClientId: clientId,
        active: true,
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

      if (!category) {
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
      if (submittedMappingTypes.length === 0) {
        await tx.clientCategoryMapping.deleteMany({
          where: { clientId },
        });
      } else {
        await tx.clientCategoryMapping.deleteMany({
          where: {
            clientId,
            mappingType: {
              notIn: submittedMappingTypes,
            },
          },
        });
      }

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

const learnedSchema=z.object({categoryId:z.string().uuid(),direction:z.enum(["PAYABLE","RECEIVABLE"]),mappingTypes:z.array(z.enum(acquirerMappingTypes)).min(1).max(6)});
export async function PATCH(request:Request,context:RouteContext){
  const member=await getMember();
  if(!member)return NextResponse.json({error:"Sua sessão expirou."},{status:401});
  const permissions=await getRolePermissions(member.organizationId,member.role);
  if(!permissions.CLIENTS.canEdit)return NextResponse.json({error:"Sem permissão para salvar categorias do cliente."},{status:403});
  const {id:clientId}=await context.params;
  if(!await prisma.client.findFirst({where:{id:clientId,organizationId:member.organizationId},select:{id:true}}))return NextResponse.json({error:"Cliente não encontrado."},{status:404});
  const body=learnedSchema.safeParse(await request.json().catch(()=>null));
  if(!body.success)return NextResponse.json({error:"Categoria ou tipo de vínculo inválido."},{status:400});
  try{
    const mappings=await saveAcquirerCategory({...body.data,organizationId:member.organizationId,clientId,userId:member.userId});
    return NextResponse.json({saved:true,mappings});
  }catch{return NextResponse.json({error:"Não foi possível salvar a categoria deste cliente. Confira a conexão e se ela é compatível com receita ou despesa."},{status:409});}
}
