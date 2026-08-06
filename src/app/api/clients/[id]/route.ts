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

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function cleanDocument(value: string): string {
  return value.replace(/\D/g, "");
}

export async function GET(
  _request: Request,
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

    const { id } = await context.params;

    const [client, categories] = await Promise.all([
      prisma.client.findFirst({
        where: {
          id,
          organizationId: member.organizationId,
        },
        include: {
          acquirers: {
            orderBy: { name: "asc" },
          },
          categoryMappings: {
            include: {
              category: true,
              subcategory: true,
            },
          },
          banks: {
            orderBy: { bankName: "asc" },
          },
          cards: {
            orderBy: { brand: "asc" },
          },
          _count: {
            select: { imports: true },
          },
        },
      }),
      prisma.category.findMany({
        where: {
          organizationId: member.organizationId,
          active: true,
          parentId: null,
        },
        orderBy: { name: "asc" },
        include: {
          children: {
            where: { active: true },
            orderBy: { name: "asc" },
          },
        },
      }),
    ]);

    if (!client) {
      return NextResponse.json(
        { error: "Cliente não encontrado." },
        { status: 404 },
      );
    }

    const rateRows = await prisma.$queryRaw<
      Array<{
        id: string;
        clientAcquirerId: string;
        transactionType: string;
        installments: number | null;
        brand: string | null;
        expectedRate: unknown;
        tolerance: unknown;
      }>
    >`
      SELECT "id", "clientAcquirerId", "transactionType", "installments", "brand", "expectedRate", "tolerance"
      FROM "ClientAcquirerRate"
      WHERE "clientAcquirerId" IN (
        SELECT "id" FROM "ClientAcquirer" WHERE "clientId" = ${id}
      )
      ORDER BY "transactionType", "installments", "brand"
    `;

    const clientWithRates = {
      ...client,
      acquirers: client.acquirers.map((acquirer) => ({
        ...acquirer,
        rates: rateRows
          .filter((rate) => rate.clientAcquirerId === acquirer.id)
          .map((rate) => ({
            id: rate.id,
            clientAcquirerId: rate.clientAcquirerId,
            modality: rate.transactionType,
            installments: rate.installments,
            cardBrand: rate.brand,
            rate: Number(rate.expectedRate),
            tolerance: Number(rate.tolerance),
          })),
      })),
    };

    return NextResponse.json({
      client: clientWithRates,
      categories,
    });
  } catch (error) {
    console.error("Erro ao carregar cliente:", error);

    return NextResponse.json(
      { error: "Não foi possível carregar o cliente." },
      { status: 500 },
    );
  }
}

export async function PATCH(
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
        { error: "Você não possui permissão para editar clientes." },
        { status: 403 },
      );
    }

    const { id } = await context.params;
    const body = (await request.json()) as {
      name?: unknown;
      document?: unknown;
      active?: unknown;
      operationalEmail?: unknown;
      operationalEmailCc?: unknown;
      cluster?: unknown;
    };

    const name =
      typeof body.name === "string" ? body.name.trim() : "";
    const document =
      typeof body.document === "string"
        ? cleanDocument(body.document)
        : "";
    const active =
      typeof body.active === "boolean" ? body.active : true;
    const operationalEmail = typeof body.operationalEmail === "string" ? body.operationalEmail.trim() || null : null;
    const operationalEmailCc = typeof body.operationalEmailCc === "string" ? body.operationalEmailCc.trim() || null : null;
    const cluster = ["A", "B", "C"].includes(String(body.cluster)) ? String(body.cluster) as "A" | "B" | "C" : "C";

    if (name.length < 3) {
      return NextResponse.json(
        { error: "Informe um nome com pelo menos 3 caracteres." },
        { status: 400 },
      );
    }

    if (document.length !== 14) {
      return NextResponse.json(
        { error: "Informe um CNPJ válido." },
        { status: 400 },
      );
    }

    const currentClient = await prisma.client.findFirst({
      where: {
        id,
        organizationId: member.organizationId,
      },
      select: { id: true },
    });

    if (!currentClient) {
      return NextResponse.json(
        { error: "Cliente não encontrado." },
        { status: 404 },
      );
    }

    const normalizedName = normalizeName(name);

    const conflict = await prisma.client.findFirst({
      where: {
        organizationId: member.organizationId,
        id: { not: id },
        OR: [{ normalizedName }, { document }],
      },
      select: { id: true },
    });

    if (conflict) {
      return NextResponse.json(
        {
          error:
            "Já existe outro cliente com esse nome ou CNPJ.",
        },
        { status: 409 },
      );
    }

    const client = await prisma.client.update({
      where: { id },
      data: {
        name,
        normalizedName,
        document,
        active,
        operationalEmail,
        operationalEmailCc,
        cluster,
      },
      include: {
        acquirers: true,
        categoryMappings: {
          include: {
            category: true,
            subcategory: true,
          },
        },
        banks: true,
        cards: true,
        _count: {
          select: { imports: true },
        },
      },
    });

    return NextResponse.json({
      message: "Cliente atualizado com sucesso.",
      client,
    });
  } catch (error) {
    console.error("Erro ao editar cliente:", error);

    return NextResponse.json(
      { error: "Não foi possível editar o cliente." },
      { status: 500 },
    );
  }
}
