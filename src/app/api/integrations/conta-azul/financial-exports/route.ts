import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getRolePermissions } from "@/modules/permissions/permissions";
import {
  findAuthorizedClient,
  getPurchaseInvoiceMember,
} from "@/modules/purchase-invoices/server/auth";
import { contaAzulRequest } from "@/modules/purchase-invoices/server/conta-azul";
import {
  apiItems,
  buildFinancialEventPayload,
  contaAzulOptions,
  findContaAzulOption,
  installmentIdFrom,
  normalizeContaAzulLabel,
  protocolError,
  protocolIdFrom,
  protocolState,
  requiredContactProfiles,
  resourceIdFromProtocol,
  technicalContactProfileSuffix,
} from "@/modules/conta-azul/financial-export";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const lineSchema = z.object({
  lineKey: z.string().trim().min(1).max(500),
  direction: z.enum(["PAYABLE", "RECEIVABLE"]),
  competenceDate: z.string().regex(datePattern),
  dueDate: z.string().regex(datePattern),
  paymentDate: z.string().regex(datePattern).nullable().optional(),
  description: z.string().trim().min(1).max(500),
  amount: z.number().finite().refine((value) => Math.abs(value) >= 0.01),
  categoryName: z.string().trim().min(1).max(250),
  costCenterName: z.string().trim().max(250).nullable().optional(),
  observation: z.string().trim().max(2000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
const payloadSchema = z.object({
  clientId: z.string().trim().min(1),
  module: z.enum(["CREDIT_CARD_INVOICE", "ACQUIRER"]),
  sourceKey: z.string().trim().min(1).max(1000),
  sourceName: z.string().trim().min(1).max(500),
  contactId: z.string().uuid().nullable().optional(),
  contactName: z.string().trim().max(250).nullable().optional(),
  counterpartyHint: z.string().trim().max(250).nullable().optional(),
  financialAccountId: z.string().uuid(),
  financialAccountName: z.string().trim().max(250).nullable().optional(),
  settle: z.boolean(),
  lines: z.array(lineSchema).min(1).max(5000),
});

type ParsedPayload = z.infer<typeof payloadSchema>;
type ResolvedPayload = ParsedPayload & { contactId: string };

function stableHash(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function asDate(value: string) {
  return new Date(`${value}T12:00:00.000Z`);
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function findOrCreateExport(input: {
  body: ResolvedPayload;
  organizationId: string;
  userId: string;
  connectionId: string;
}) {
  const sourceKey = stableHash(`${input.body.module}|${input.body.sourceKey}`);
  const existing = await prisma.contaAzulFinancialExport.findUnique({
    where: {
      clientId_module_sourceKey: {
        clientId: input.body.clientId,
        module: input.body.module,
        sourceKey,
      },
    },
    include: { lines: true },
  });
  if (existing) return existing;

  try {
    return await prisma.contaAzulFinancialExport.create({
      data: {
        organizationId: input.organizationId,
        clientId: input.body.clientId,
        connectionId: input.connectionId,
        createdById: input.userId,
        module: input.body.module,
        sourceKey,
        sourceName: input.body.sourceName,
        contactId: input.body.contactId,
        contactName: input.body.contactName || null,
        financialAccountId: input.body.financialAccountId,
        financialAccountName: input.body.financialAccountName || null,
        settleRequested: input.body.settle,
        metadata: asJson({
          originalSourceKey: input.body.sourceKey,
          requestedLineCount: input.body.lines.length,
        }),
        lines: {
          create: input.body.lines.map((line) => ({
            lineKey: stableHash(line.lineKey),
            direction: line.direction,
            competenceDate: asDate(line.competenceDate),
            dueDate: asDate(line.dueDate),
            paymentDate: line.paymentDate ? asDate(line.paymentDate) : null,
            description: line.description,
            amount: Math.abs(line.amount),
            categoryName: line.categoryName,
            costCenterName: line.costCenterName || null,
            metadata: asJson({
              originalLineKey: line.lineKey,
              observation: line.observation || null,
              source: line.metadata || null,
            }),
          })),
        },
      },
      include: { lines: true },
    });
  } catch {
    const raced = await prisma.contaAzulFinancialExport.findUnique({
      where: {
        clientId_module_sourceKey: {
          clientId: input.body.clientId,
          module: input.body.module,
          sourceKey,
        },
      },
      include: { lines: true },
    });
    if (!raced) throw new Error("Não foi possível preparar o envio ao Conta Azul.");
    return raced;
  }
}

async function resolveTechnicalContact(
  clientId: string,
  module: ParsedPayload["module"],
  direction: "PAYABLE" | "RECEIVABLE",
  requestedName?: string | null,
  requestedContactId?: string | null,
  requestedContactName?: string | null,
) {
  const name = requestedName?.trim()
    || (module === "ACQUIRER" ? "MOVIMENTAÇÕES DE ADQUIRENTES" : "FATURAS DE CARTÃO");
  const technicalObservation = module === "ACQUIRER"
    ? "Contato técnico criado pelo Fortuno Hub para lançamentos financeiros de adquirentes."
    : "Contato técnico criado pelo Fortuno Hub para lançamentos financeiros de faturas de cartão.";
  const requiredProfiles = requiredContactProfiles([direction]);
  const requiredProfile = requiredProfiles[0];
  const technicalName = `FORTUNO HUB - ${name} - ${technicalContactProfileSuffix(requiredProfiles)}`;

  async function compatiblePerson(option: { value: string; label: string }) {
    const body = await contaAzulRequest<Record<string, unknown>>(
      clientId,
      `/v1/pessoas/${option.value}`,
    );
    const person = apiItems(body)[0] ?? body;
    const profiles = Array.isArray(person.perfis)
      ? person.perfis.flatMap((profile) => {
        if (typeof profile === "string") {
          return [normalizeContaAzulLabel(profile)];
        }
        if (!profile || typeof profile !== "object") return [];
        const type = (profile as Record<string, unknown>).tipo_perfil;
        return typeof type === "string" ? [normalizeContaAzulLabel(type)] : [];
      })
      : [];
    return requiredProfiles.every(
      (profile) => profiles.includes(normalizeContaAzulLabel(profile)),
    ) ? option : null;
  }

  async function findPerson(candidateName: string) {
    const params = new URLSearchParams({
      pagina: "1",
      tamanho_pagina: "100",
      busca: candidateName,
      tipo_perfil: requiredProfile,
      com_endereco: "false",
    });
    const peopleBody = await contaAzulRequest<unknown>(
      clientId,
      `/v1/pessoas?${params.toString()}`,
    );
    return findContaAzulOption(contaAzulOptions(peopleBody), candidateName);
  }

  if (requestedContactId) {
    const compatible = await compatiblePerson({
      value: requestedContactId,
      label: requestedContactName?.trim() || name,
    });
    if (compatible) return compatible;
  }

  const existing = await findPerson(technicalName);
  if (existing) {
    const compatible = await compatiblePerson(existing);
    if (compatible) return compatible;
  }

  const created = await contaAzulRequest<Record<string, unknown>>(clientId, "/v1/pessoas", {
    method: "POST",
    body: JSON.stringify({
      ativo: true,
      nome: technicalName,
      observacao: technicalObservation,
      perfis: [{ tipo_perfil: requiredProfile }],
      tipo_pessoa: "Jurídica",
    }),
  });
  const createdOption = contaAzulOptions(created)[0];
  if (!createdOption) {
    throw new Error("O Conta Azul criou o contato técnico, mas não devolveu seu identificador.");
  }
  return createdOption;
}

async function findFinancialInstallment(input: {
  clientId: string;
  direction: "PAYABLE" | "RECEIVABLE";
  competenceDate: Date;
  dueDate: Date;
  description: string;
  amount: number;
}) {
  const params = new URLSearchParams({
    pagina: "1",
    tamanho_pagina: "100",
    data_competencia_de: dateOnly(input.competenceDate),
    data_competencia_ate: dateOnly(input.competenceDate),
    data_vencimento_de: dateOnly(input.dueDate),
    data_vencimento_ate: dateOnly(input.dueDate),
    valor_de: input.amount.toFixed(2),
    valor_ate: input.amount.toFixed(2),
    descricao: input.description,
  });
  const endpoint = input.direction === "RECEIVABLE"
    ? "/v1/financeiro/eventos-financeiros/contas-a-receber/buscar"
    : "/v1/financeiro/eventos-financeiros/contas-a-pagar/buscar";
  const body = await contaAzulRequest<unknown>(input.clientId, `${endpoint}?${params.toString()}`);
  const requestedDescription = normalizeContaAzulLabel(input.description);
  const matching = apiItems(body).filter((item) => {
    const description = typeof item.descricao === "string" ? item.descricao : "";
    return normalizeContaAzulLabel(description) === requestedDescription;
  });
  return {
    installmentId: matching.length === 1 ? installmentIdFrom(matching) : null,
    ambiguous: matching.length > 1,
  };
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function createPendingLines(input: {
  clientId: string;
  exportId: string;
  contactIds: Record<"PAYABLE" | "RECEIVABLE", string>;
  financialAccountId: string;
  categories: ReturnType<typeof contaAzulOptions>;
  costCenters: ReturnType<typeof contaAzulOptions>;
}) {
  const pending = await prisma.contaAzulFinancialExportLine.findMany({
    where: {
      exportId: input.exportId,
      OR: [
        { status: "PENDING" },
        { status: "FAILED", externalProtocolId: null },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 20,
  });

  for (const line of pending) {
    const category = findContaAzulOption(
      input.categories,
      line.categoryName,
      line.direction === "RECEIVABLE" ? "RECEITA" : "DESPESA",
    );
    const costCenter = line.costCenterName
      ? findContaAzulOption(input.costCenters, line.costCenterName)
      : null;
    if (!category || (line.costCenterName && !costCenter)) continue;

    const metadata = metadataRecord(line.metadata);
    const observation = typeof metadata.observation === "string" && metadata.observation
      ? metadata.observation
      : "Lançamento revisado e enviado pelo Fortuno Hub.";
    const payload = buildFinancialEventPayload({
      direction: line.direction,
      competenceDate: dateOnly(line.competenceDate),
      dueDate: dateOnly(line.dueDate),
      description: line.description,
      observation,
      amount: Number(line.amount),
      contactId: input.contactIds[line.direction],
      financialAccountId: input.financialAccountId,
      categoryId: category.value,
      costCenterId: costCenter?.value,
    });
    const endpoint = line.direction === "RECEIVABLE"
      ? "/v1/financeiro/eventos-financeiros/contas-a-receber"
      : "/v1/financeiro/eventos-financeiros/contas-a-pagar";

    try {
      const response = await contaAzulRequest<unknown>(input.clientId, endpoint, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const protocolId = protocolIdFrom(response);
      if (!protocolId) throw new Error("O Conta Azul não devolveu o protocolo do lançamento.");
      await prisma.contaAzulFinancialExportLine.update({
        where: { id: line.id },
        data: {
          status: "CREATED",
          contaAzulCategoryId: category.value,
          contaAzulCostCenterId: costCenter?.value || null,
          externalProtocolId: protocolId,
          lastError: null,
        },
      });
    } catch (error) {
      await prisma.contaAzulFinancialExportLine.update({
        where: { id: line.id },
        data: {
          status: "FAILED",
          lastError: error instanceof Error ? error.message : "Falha ao criar o lançamento.",
        },
      });
    }
    // Limite oficial: 10 requisições por segundo por conta conectada.
    await sleep(120);
  }
}

async function settleCreatedLines(input: {
  clientId: string;
  exportId: string;
  financialAccountId: string;
}) {
  const created = await prisma.contaAzulFinancialExportLine.findMany({
    where: {
      exportId: input.exportId,
      OR: [
        { status: "CREATED" },
        { status: "FAILED", externalProtocolId: { not: null } },
      ],
    },
    orderBy: { updatedAt: "asc" },
    take: 20,
  });

  for (const line of created) {
    try {
      let eventId = line.externalEventId;
      if (!eventId && line.externalProtocolId) {
        const protocol = await contaAzulRequest<unknown>(
          input.clientId,
          `/v1/protocolo/${line.externalProtocolId}`,
        );
        await sleep(120);
        const state = protocolState(protocol);
        if (state === "ERROR") {
          throw new Error(protocolError(protocol) || "O Conta Azul rejeitou o lançamento.");
        }
        if (state === "PENDING") {
          await sleep(120);
          continue;
        }
        eventId = resourceIdFromProtocol(protocol);
        if (!eventId) {
          throw new Error("O lançamento foi processado, mas o Conta Azul não informou seu identificador.");
        }
      }
      if (eventId && eventId !== line.externalEventId) {
        await prisma.contaAzulFinancialExportLine.update({
          where: { id: line.id },
          data: { externalEventId: eventId, status: "CREATED", lastError: null },
        });
      }

      let installmentId = line.externalInstallmentId;
      if (!installmentId && eventId) {
        for (let attempt = 0; attempt < 3 && !installmentId; attempt += 1) {
          const installments = await contaAzulRequest<unknown>(
            input.clientId,
            `/v1/financeiro/eventos-financeiros/${eventId}/parcelas`,
          );
          installmentId = installmentIdFrom(installments);
          if (!installmentId) await sleep(500);
        }
      }
      if (!installmentId) {
        const found = await findFinancialInstallment({
          clientId: input.clientId,
          direction: line.direction,
          competenceDate: line.competenceDate,
          dueDate: line.dueDate,
          description: line.description,
          amount: Number(line.amount),
        });
        installmentId = found.installmentId;
        if (found.ambiguous) {
          throw new Error("O Conta Azul devolveu mais de uma parcela possível para este lançamento. A retomada foi interrompida para evitar duplicidade.");
        }
        if (!installmentId && Date.now() - line.createdAt.getTime() >= 120_000) {
          await prisma.contaAzulFinancialExportLine.update({
            where: { id: line.id },
            data: {
              status: "PENDING",
              externalProtocolId: null,
              externalEventId: null,
              externalInstallmentId: null,
              lastError: null,
            },
          });
          continue;
        }
      }
      if (!installmentId) throw new Error("Não foi possível localizar a parcela criada no Conta Azul.");
      if (installmentId !== line.externalInstallmentId) {
        await prisma.contaAzulFinancialExportLine.update({
          where: { id: line.id },
          data: { externalInstallmentId: installmentId, status: "CREATED", lastError: null },
        });
      }

      const amount = Number(line.amount);
      const existingSettlements = await contaAzulRequest<unknown>(
        input.clientId,
        `/v1/financeiro/eventos-financeiros/parcelas/${installmentId}/baixa`,
      );
      await sleep(120);
      const existingSettlementId = installmentIdFrom(existingSettlements);
      const settlement = existingSettlementId
        ? { id: existingSettlementId }
        : await contaAzulRequest<Record<string, unknown>>(
          input.clientId,
          `/v1/financeiro/eventos-financeiros/parcelas/${installmentId}/baixa`,
        {
          method: "POST",
          body: JSON.stringify({
            data_pagamento: dateOnly(line.paymentDate || line.dueDate),
            composicao_valor: {
              multa: 0,
              juros: 0,
              valor_bruto: amount,
              desconto: 0,
              taxa: 0,
            },
            conta_financeira: input.financialAccountId,
            metodo_pagamento: "OUTRO",
            observacao: "Baixa registrada pelo Fortuno Hub.",
          }),
        },
      );
      const settlementId = typeof settlement.id === "string" ? settlement.id : null;
      await prisma.contaAzulFinancialExportLine.update({
        where: { id: line.id },
        data: {
          status: "SETTLED",
          externalEventId: eventId,
          externalInstallmentId: installmentId,
          externalSettlementId: settlementId,
          lastError: null,
        },
      });
    } catch (error) {
      await prisma.contaAzulFinancialExportLine.update({
        where: { id: line.id },
        data: {
          status: "FAILED",
          lastError: error instanceof Error ? error.message : "Falha ao registrar a baixa.",
        },
      });
    }
    await sleep(120);
  }
}

export async function POST(request: Request) {
  const member = await getPurchaseInvoiceMember();
  if (!member) return NextResponse.json({ error: "Sua sessão expirou." }, { status: 401 });
  const permissions = await getRolePermissions(member.organizationId, member.role);
  if (!permissions.IMPORTS.canExport && !permissions.PURCHASE_INVOICES.canExport) {
    return NextResponse.json({ error: "Você não possui permissão para enviar lançamentos." }, { status: 403 });
  }

  const parsed = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Revise os dados do envio ao Conta Azul." }, { status: 400 });
  }
  const requestedBody = parsed.data;
  const client = await findAuthorizedClient(member, requestedBody.clientId);
  if (!client) return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
  const connection = await prisma.contaAzulConnection.findFirst({
    where: {
      clientId: requestedBody.clientId,
      organizationId: member.organizationId,
      active: true,
      status: "CONNECTED",
    },
    select: { id: true },
  });
  if (!connection) {
    return NextResponse.json({ error: "Conecte este cliente à Conta Azul antes de enviar." }, { status: 400 });
  }

  let body: ResolvedPayload;
  const contactIds: Record<"PAYABLE" | "RECEIVABLE", string> = {
    PAYABLE: "",
    RECEIVABLE: "",
  };
  try {
    const directions = Array.from(new Set(
      requestedBody.lines.map((line) => line.direction),
    ));
    const primaryDirection = directions[0];
    let primaryContact: { value: string; label: string } | null = null;
    for (const direction of directions) {
      const technicalContact = await resolveTechnicalContact(
        requestedBody.clientId,
        requestedBody.module,
        direction,
        requestedBody.counterpartyHint || requestedBody.financialAccountName,
        direction === primaryDirection ? requestedBody.contactId : null,
        direction === primaryDirection ? requestedBody.contactName : null,
      );
      contactIds[direction] = technicalContact.value;
      if (direction === primaryDirection) primaryContact = technicalContact;
    }
    if (!primaryContact) throw new Error("Nenhum vínculo técnico foi preparado.");
    body = {
      ...requestedBody,
      contactId: primaryContact.value,
      contactName: primaryContact.label,
    };
  } catch (error) {
    const context = requestedBody.module === "ACQUIRER" ? "da adquirente" : "da fatura";
    return NextResponse.json({
      error: error instanceof Error
        ? `Não foi possível preparar o vínculo técnico ${context}: ${error.message}`
        : `Não foi possível preparar o vínculo técnico ${context}.`,
    }, { status: 502 });
  }
  const exportBatch = await findOrCreateExport({
    body,
    organizationId: member.organizationId,
    userId: member.userId,
    connectionId: connection.id,
  });
  if (
    exportBatch.financialAccountId !== body.financialAccountId
    || exportBatch.settleRequested !== body.settle
  ) {
    return NextResponse.json({
      error: "Este arquivo já começou a ser enviado com outro contato, conta ou situação de baixa.",
    }, { status: 409 });
  }
  if (exportBatch.contactId !== body.contactId) {
    await prisma.contaAzulFinancialExport.update({
      where: { id: exportBatch.id },
      data: {
        contactId: body.contactId,
        contactName: body.contactName || null,
      },
    });
  }
  const persistedLineKeys = new Set(exportBatch.lines.map((line) => line.lineKey));
  const requestedLineKeys = new Set(body.lines.map((line) => stableHash(line.lineKey)));
  if (
    persistedLineKeys.size !== requestedLineKeys.size
    || Array.from(requestedLineKeys).some((lineKey) => !persistedLineKeys.has(lineKey))
  ) {
    return NextResponse.json({
      error: "Este arquivo já começou a ser enviado com outro conjunto de lançamentos. Inicie uma nova importação para evitar duplicidades.",
    }, { status: 409 });
  }

  const categoriesBody = await contaAzulRequest<unknown>(
    body.clientId,
    "/v1/categorias?pagina=1&tamanho_pagina=1000",
  );
  const costCentersBody = await contaAzulRequest<unknown>(
    body.clientId,
    "/v1/centro-de-custo?pagina=1&tamanho_pagina=1000",
  );
  const categories = contaAzulOptions(categoriesBody);
  const costCenters = contaAzulOptions(costCentersBody);
  const unresolvedCategories = Array.from(new Set(
    body.lines.filter((line) => !findContaAzulOption(
      categories,
      line.categoryName,
      line.direction === "RECEIVABLE" ? "RECEITA" : "DESPESA",
    ))
      .map((line) => line.categoryName),
  ));
  const unresolvedCostCenters = Array.from(new Set(
    body.lines.filter(
      (line) => line.costCenterName && !findContaAzulOption(costCenters, line.costCenterName),
    ).map((line) => line.costCenterName as string),
  ));
  if (unresolvedCategories.length || unresolvedCostCenters.length) {
    return NextResponse.json({
      error: "Existem classificações que não foram localizadas no Conta Azul.",
      unresolvedCategories,
      unresolvedCostCenters,
    }, { status: 400 });
  }

  await createPendingLines({
    clientId: body.clientId,
    exportId: exportBatch.id,
    contactIds,
    financialAccountId: body.financialAccountId,
    categories,
    costCenters,
  });
  if (body.settle) {
    await settleCreatedLines({
      clientId: body.clientId,
      exportId: exportBatch.id,
      financialAccountId: body.financialAccountId,
    });
  }

  const grouped = await prisma.contaAzulFinancialExportLine.groupBy({
    by: ["status"],
    where: { exportId: exportBatch.id },
    _count: { _all: true },
  });
  const counts = { PENDING: 0, CREATED: 0, SETTLED: 0, FAILED: 0 };
  for (const item of grouped) counts[item.status] = item._count._all;
  const done = counts.PENDING === 0
    && counts.FAILED === 0
    && (!body.settle || counts.CREATED === 0);
  const hasProgress = counts.CREATED > 0 || counts.SETTLED > 0;
  const status = done ? "COMPLETED" : counts.FAILED > 0 ? (hasProgress ? "PARTIAL" : "FAILED") : "PROCESSING";
  const firstFailure = counts.FAILED > 0
    ? await prisma.contaAzulFinancialExportLine.findFirst({
      where: { exportId: exportBatch.id, status: "FAILED" },
      select: { lastError: true },
    })
    : null;
  await prisma.contaAzulFinancialExport.update({
    where: { id: exportBatch.id },
    data: {
      status,
      completedAt: done ? new Date() : null,
      lastError: firstFailure?.lastError || null,
    },
  });

  return NextResponse.json({
    exportId: exportBatch.id,
    contactId: body.contactId,
    contactName: body.contactName || null,
    status,
    done,
    needsContinue: !done && counts.FAILED === 0,
    counts,
    message: done
      ? body.settle
        ? "Todos os lançamentos foram criados e baixados no Conta Azul."
        : "Todos os lançamentos foram criados como pendentes no Conta Azul."
      : firstFailure?.lastError || "O Conta Azul ainda está processando o envio. O Fortuno Hub continuará automaticamente.",
  });
}
