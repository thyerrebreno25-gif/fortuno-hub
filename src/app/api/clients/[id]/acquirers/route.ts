import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const MANAGER_ROLES = new Set(["MASTER", "ADMIN", "MANAGER"]);
const RECEIPT_RULES = new Set([
  "WITHOUT_ADVANCE",
  "AUTOMATIC_ADVANCE",
  "OCCASIONAL_ADVANCE",
]);
const MODALITIES = new Set([
  "DEBIT",
  "CREDIT",
  "PIX",
  "VOUCHER",
  "OTHER",
]);

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
    select: { organizationId: true, role: true },
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

function normalizeBrand(value: string | null): string | null {
  if (!value) return null;
  const normalized = normalizeName(value);
  return normalized || null;
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const member = await getMember();

    if (!member) {
      return NextResponse.json(
        { error: "Sua sessão expirou ou você não pertence a uma organização." },
        { status: 401 },
      );
    }

    if (!MANAGER_ROLES.has(member.role)) {
      return NextResponse.json(
        { error: "Você não possui permissão para editar adquirentes." },
        { status: 403 },
      );
    }

    const { id: clientId } = await context.params;
    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: member.organizationId },
      select: { id: true },
    });

    if (!client) {
      return NextResponse.json(
        { error: "Cliente não encontrado." },
        { status: 404 },
      );
    }

    const body = (await request.json()) as { acquirers?: unknown };

    if (!Array.isArray(body.acquirers)) {
      return NextResponse.json(
        { error: "A lista de adquirentes é inválida." },
        { status: 400 },
      );
    }

    const parsed = body.acquirers.map((item, index) => {
      const row = item as {
        name?: unknown;
        receiptRule?: unknown;
        active?: unknown;
        rates?: unknown;
      };

      const name = typeof row.name === "string" ? row.name.trim() : "";
      const receiptRule =
        typeof row.receiptRule === "string" && RECEIPT_RULES.has(row.receiptRule)
          ? row.receiptRule
          : "WITHOUT_ADVANCE";
      const active = typeof row.active === "boolean" ? row.active : true;

      if (name.length < 2) {
        throw new Error(`Informe o nome da adquirente ${index + 1}.`);
      }

      const ratesInput = Array.isArray(row.rates) ? row.rates : [];
      const rates = ratesInput.map((rateItem, rateIndex) => {
        const rateRow = rateItem as {
          modality?: unknown;
          installments?: unknown;
          cardBrand?: unknown;
          rate?: unknown;
          tolerance?: unknown;
        };

        const modality =
          typeof rateRow.modality === "string" && MODALITIES.has(rateRow.modality)
            ? rateRow.modality
            : "CREDIT";
        const installments =
          modality === "CREDIT" && Number(rateRow.installments) > 1 ? 2 : 1;
        const contractedRate = Number(rateRow.rate);
        const tolerance = Number(rateRow.tolerance ?? 0);
        const cardBrand =
          typeof rateRow.cardBrand === "string"
            ? rateRow.cardBrand.trim() || null
            : null;

        if (!Number.isFinite(contractedRate) || contractedRate < 0 || contractedRate > 100) {
          throw new Error(`Informe uma taxa válida na regra ${rateIndex + 1} de ${name}.`);
        }

        if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 100) {
          throw new Error(`Informe uma tolerância válida na regra ${rateIndex + 1} de ${name}.`);
        }

        return {
          modality,
          installments,
          cardBrand,
          normalizedCardBrand: normalizeBrand(cardBrand),
          rate: contractedRate,
          tolerance,
        };
      });

      const rateKeys = rates.map(
        (rate) =>
          `${rate.modality}|${rate.installments ?? "-"}|${rate.normalizedCardBrand ?? "ALL"}`,
      );

      if (new Set(rateKeys).size !== rateKeys.length) {
        throw new Error(
          `Existem taxas duplicadas em ${name}. Revise modalidade, forma e bandeira.`,
        );
      }

      return {
        name,
        normalizedName: normalizeName(name),
        receiptRule: receiptRule as
          | "WITHOUT_ADVANCE"
          | "AUTOMATIC_ADVANCE"
          | "OCCASIONAL_ADVANCE",
        active,
        rates,
      };
    });

    const normalizedNames = parsed.map((item) => item.normalizedName);
    if (new Set(normalizedNames).size !== normalizedNames.length) {
      return NextResponse.json(
        { error: "A mesma adquirente não pode ser adicionada duas vezes." },
        { status: 409 },
      );
    }

    const acquirers = await prisma.$transaction(async (tx) => {
      await tx.clientAcquirer.deleteMany({ where: { clientId } });

      if (parsed.length > 0) {
        await tx.clientAcquirer.createMany({
          data: parsed.map(({ rates: _rates, ...item }) => ({ clientId, ...item })),
        });
      }

      const savedAcquirers = await tx.clientAcquirer.findMany({
        where: { clientId },
        orderBy: { name: "asc" },
      });

      for (const saved of savedAcquirers) {
        const source = parsed.find(
          (item) => item.normalizedName === saved.normalizedName,
        );

        for (const rate of source?.rates ?? []) {
          await tx.$executeRaw`
            INSERT INTO "ClientAcquirerRate"
              ("id", "clientAcquirerId", "transactionType", "installments", "brand", "normalizedBrand", "expectedRate", "tolerance", "active", "createdAt", "updatedAt")
            VALUES
              (${randomUUID()}, ${saved.id}, ${rate.modality}::"AcquirerTransactionType", ${rate.installments}, ${rate.cardBrand}, ${rate.normalizedCardBrand}, ${rate.rate}, ${rate.tolerance}, TRUE, NOW(), NOW())
          `;
        }
      }

      const rateRows = await tx.$queryRaw<
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
          SELECT "id" FROM "ClientAcquirer" WHERE "clientId" = ${clientId}
        )
        ORDER BY "transactionType", "installments", "brand"
      `;

      return savedAcquirers.map((acquirer) => ({
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
      }));
    });

    return NextResponse.json({
      message: "Adquirentes e taxas contratadas salvas com sucesso.",
      acquirers,
    });
  } catch (error) {
    console.error("Erro ao salvar adquirentes:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível salvar as adquirentes.",
      },
      { status: 500 },
    );
  }
}
