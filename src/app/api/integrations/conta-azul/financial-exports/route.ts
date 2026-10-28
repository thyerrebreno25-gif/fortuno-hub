import crypto from "node:crypto";
import { confirmFinancialInstallment, confirmFinancialSettlement } from "@/modules/conta-azul/financial-confirmation";
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
import { allocationClientId, exportLineDestinationClient, exportLineFinancialAccount, invalidAccountAllocationLines } from "@/modules/conta-azul/financial-account-allocation";
import {
  automaticFinancialContactName,
  apiItems,
  buildDirectFinancialEventPayload,
  buildFinancialEventPayload,
  contaAzulOptions,
  financialEventIdFromCreation,
  findContaAzulOption,
  installmentIdFrom,
  installmentIdFromCreation,
  normalizeContaAzulLabel,
  protocolError,
  protocolIdFrom,
  protocolState,
  requiredContactProfiles,
  resourceIdFromProtocol,
} from "@/modules/conta-azul/financial-export";

export const maxDuration = 300;

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
  financialAccountId: z.string().uuid().nullable().optional(),
  financialAccountName: z.string().trim().max(250).nullable().optional(),
  destinationClientId: z.string().trim().min(1).max(250).nullable().optional(),
  destinationClientName: z.string().trim().max(250).nullable().optional(),
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
  useLineAccounts: z.boolean().default(false),
  lines: z.array(lineSchema).min(1).max(5000),
}).superRefine((body, context) => {
  if (body.useLineAccounts && body.module !== "CREDIT_CARD_INVOICE") {
    context.addIssue({ code: "custom", message: "Rateio por conta disponível apenas para faturas.", path: ["useLineAccounts"] });
  }
  body.lines.forEach((line, index) => {
    if ((body.useLineAccounts && !line.financialAccountId) || (!body.useLineAccounts && line.financialAccountId)) {
      context.addIssue({ code: "custom", message: "Revise a conta e a opção de rateio do lançamento.", path: ["lines", index, "financialAccountId"] });
    }
    if (!body.useLineAccounts && line.destinationClientId) {
      context.addIssue({ code: "custom", message: "Ative o rateio para selecionar um cadastro de destino.", path: ["lines", index, "destinationClientId"] });
    }
  });
  if (body.useLineAccounts && body.financialAccountId !== body.lines[0]?.financialAccountId) {
    context.addIssue({ code: "custom", message: "Conta do lote incompatível com o rateio.", path: ["financialAccountId"] });
  }
  if (new Set(body.lines.map((line) => line.lineKey)).size !== body.lines.length) {
    context.addIssue({ code: "custom", message: "Há lançamentos repetidos no lote.", path: ["lines"] });
  }
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

function contaAzulErrorStatus(error: unknown) {
  return error && typeof error === "object" && typeof (error as { status?: unknown }).status === "number"
    ? (error as { status: number }).status
    : null;
}

function isTransientContaAzulError(error: unknown) {
  if (error && typeof error === "object" && (error as { transient?: unknown }).transient === true) return true;
  const message = error instanceof Error ? error.message : String(error || "");
  return /JS-EXTRACT-LOKI-VARIABLES|ScriptExecutionFailed|falha interna temporária|erro 5\d\d/i.test(message);
}

function lineFailureMessage(line: { description: string; dueDate: Date; amount: unknown }, error: unknown) {
  const description = line.description.length > 90 ? `${line.description.slice(0, 87)}...` : line.description;
  const amount = Number(line.amount).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const reason = error instanceof Error ? error.message : "Falha não identificada no Conta Azul.";
  return `Lançamento "${description}" (${dateOnly(line.dueDate)}, ${amount}): ${reason}`;
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
          useLineAccounts: input.body.useLineAccounts,
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
              ...(input.body.useLineAccounts ? {
                financialAccountId: line.financialAccountId,
                financialAccountName: line.financialAccountName || null,
                destinationClientId: allocationClientId(line, input.body.clientId),
                destinationClientName: line.destinationClientName || null,
              } : {}),
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
    : direction === "PAYABLE" && requestedName?.trim()
      ? `Fornecedor do cartão ${requestedName.trim()} vinculado automaticamente pelo Fortuno Hub.`
      : "Contato técnico criado pelo Fortuno Hub para lançamentos financeiros de faturas de cartão.";
  const requiredProfiles = requiredContactProfiles([direction]);
  const requiredProfile = requiredProfiles[0];
  const technicalName = module === "CREDIT_CARD_INVOICE" && direction === "PAYABLE"
    ? requestedName?.trim() || automaticFinancialContactName(requiredProfiles)
    : automaticFinancialContactName(requiredProfiles);

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
  financialAccountId: string;
  reference?: string;
  eventId?: string | null;
  categoryId?: string | null;
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
    ids_contas_financeiras: input.financialAccountId,
  });
  const endpoint = input.direction === "RECEIVABLE"
    ? "/v1/financeiro/eventos-financeiros/contas-a-receber/buscar"
    : "/v1/financeiro/eventos-financeiros/contas-a-pagar/buscar";
  const body = await contaAzulRequest<unknown>(input.clientId, `${endpoint}?${params.toString()}`);
  const matching: string[] = [];
  const rows = apiItems(body);
  if (rows.length >= 100 || Number(metadataRecord(body).itens_totais || 0) > rows.length) throw new Error("Consulta da parcela incompleta. Confira o histórico antes de retomar.");
  for (const candidate of rows) {
    if (normalizeContaAzulLabel(String(candidate.descricao || "")) !== normalizeContaAzulLabel(input.description) || typeof candidate.id !== "string") continue;
    const detail = await contaAzulRequest<unknown>(input.clientId, "/v1/financeiro/eventos-financeiros/parcelas/" + candidate.id);
    const record = metadataRecord(detail);
    if (input.reference && !String(record.nota || "").includes(input.reference)) continue;
    if (input.eventId && metadataRecord(record.evento).id !== input.eventId) continue;
    confirmFinancialInstallment(detail, { ...input, competenceDate: dateOnly(input.competenceDate), dueDate: dateOnly(input.dueDate) });
    matching.push(candidate.id);
  }
  return { installmentId: matching.length === 1 ? matching[0] : null, ambiguous: matching.length > 1 };
}

async function recoverInstallmentAfterUncertainCreation(input: Parameters<typeof findFinancialInstallment>[0]) {
  for (const delay of [500, 1_000, 1_500]) {
    await sleep(delay);
    try {
      const found = await findFinancialInstallment(input);
      if (found.ambiguous) {
        throw new Error("O Conta Azul devolveu mais de um lançamento possível após a falha. A retomada foi interrompida para evitar duplicidade.");
      }
      if (found.installmentId) return found.installmentId;
    } catch (error) {
      if (!isTransientContaAzulError(error)) throw error;
    }
  }
  return null;
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

type ExportClientContext = {
  categories: ReturnType<typeof contaAzulOptions>;
  costCenters: ReturnType<typeof contaAzulOptions>;
  contactIds: Record<"PAYABLE" | "RECEIVABLE", string>;
};

function exportResumeError(batch: Awaited<ReturnType<typeof findOrCreateExport>>, body: ParsedPayload): string | null {
  if (batch.financialAccountId !== body.financialAccountId || batch.settleRequested !== body.settle
    || Boolean(metadataRecord(batch.metadata).useLineAccounts) !== body.useLineAccounts) {
    return "Este arquivo já começou a ser enviado com outra conta ou situação de baixa. Retome com as mesmas opções.";
  }
  const requested = new Map(body.lines.map((line) => [stableHash(line.lineKey), line]));
  if (batch.lines.length !== requested.size || batch.lines.some((line) => !requested.has(line.lineKey))) {
    return "Este arquivo já começou a ser enviado com outro conjunto de lançamentos. Retome o envio original para evitar duplicidades.";
  }
  if (batch.lines.some((line) => {
    const target = requested.get(line.lineKey)!;
    return line.direction !== target.direction || Math.round(Number(line.amount) * 100) !== Math.round(Math.abs(target.amount) * 100)
      || dateOnly(line.competenceDate) !== target.competenceDate || dateOnly(line.dueDate) !== target.dueDate
      || (line.paymentDate ? dateOnly(line.paymentDate) : null) !== (target.paymentDate || null)
      || normalizeContaAzulLabel(line.description) !== normalizeContaAzulLabel(target.description)
      || normalizeContaAzulLabel(line.categoryName) !== normalizeContaAzulLabel(target.categoryName)
      || normalizeContaAzulLabel(line.costCenterName || "") !== normalizeContaAzulLabel(target.costCenterName || "");
  })) return "Os dados diferem da tentativa anterior deste arquivo. Consulte Envios ao CA para conferir valores, datas e classificações antes de retomar.";
  if (batch.lines.some((line) => {
    const target = requested.get(line.lineKey)!;
    return exportLineFinancialAccount(line.metadata, batch.financialAccountId) !== (target.financialAccountId || body.financialAccountId)
      || exportLineDestinationClient(line.metadata, body.clientId) !== allocationClientId(target, body.clientId);
  })) return "Este arquivo já começou a ser enviado com outro rateio de cadastros ou contas. Retome com os mesmos destinos para evitar duplicidades.";
  return null;
}

async function createPendingLines(input: {
  clientId: string;
  exportId: string;
  financialAccountId: string;
  destinations: Map<string, ExportClientContext>;
  assertLease: () => Promise<void>;
}) {
  const pending = await prisma.contaAzulFinancialExportLine.findMany({
    where: {
      exportId: input.exportId,
      OR: [
        { status: "PENDING" },
        {
          status: "FAILED",
          externalProtocolId: null,
          externalEventId: null,
          externalInstallmentId: null,
        },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 20,
  });

  for (const line of pending) {
    await input.assertLease();
    const destinationClientId = exportLineDestinationClient(line.metadata, input.clientId);
    const destination = input.destinations.get(destinationClientId);
    if (!destination) throw new Error("Cadastro de destino não validado para este envio.");
    const category = findContaAzulOption(
      destination.categories,
      line.categoryName,
      line.direction === "RECEIVABLE" ? "RECEITA" : "DESPESA",
    );
    const costCenter = line.costCenterName
      ? findContaAzulOption(destination.costCenters, line.costCenterName)
      : null;
    if (!category || (line.costCenterName && !costCenter)) continue;

    const metadata = metadataRecord(line.metadata);
    const reference = typeof metadata.creationReference === "string" ? metadata.creationReference : "FORTUNO-" + line.lineKey;
    const observation = typeof metadata.observation === "string" && metadata.observation
      ? metadata.observation
      : "Lançamento revisado e enviado pelo Fortuno Hub.";
    const financialAccountId = exportLineFinancialAccount(line.metadata, input.financialAccountId);
    const payloadInput = {
      direction: line.direction,
      competenceDate: dateOnly(line.competenceDate),
      dueDate: dateOnly(line.dueDate),
      description: line.description,
      observation: reference + " | " + observation,
      amount: Number(line.amount),
      contactId: destination.contactIds[line.direction],
      financialAccountId,
      categoryId: category.value,
      costCenterId: costCenter?.value,
      externalReference: reference,
    };
    const directPayload = buildDirectFinancialEventPayload(payloadInput);
    const directEndpoint = line.direction === "RECEIVABLE"
      ? "/v1/financeiro/contas-a-receber"
      : "/v1/financeiro/contas-a-pagar";
    const legacyEndpoint = line.direction === "RECEIVABLE"
      ? "/v1/financeiro/eventos-financeiros/contas-a-receber"
      : "/v1/financeiro/eventos-financeiros/contas-a-pagar";
    const recoveryInput = {
      clientId: destinationClientId,
      direction: line.direction,
      competenceDate: line.competenceDate,
      dueDate: line.dueDate,
      description: line.description,
      amount: Number(line.amount),
      financialAccountId, reference, categoryId: category.value,
    };

    try {
      let response: unknown = null;
      let recoveredInstallmentId: string | null = null;
      const creationState = metadata.creationOutcome;
      if (creationState === "CREATING" || creationState === "UNCERTAIN" || line.status === "FAILED" && creationState !== "REJECTED") {
        recoveredInstallmentId = await recoverInstallmentAfterUncertainCreation(recoveryInput);
        if (!recoveredInstallmentId) throw new Error("O envio anterior não foi confirmado no CA. Nenhum lançamento será repetido automaticamente; confira o histórico do envio.");
      } else {
        await prisma.contaAzulFinancialExportLine.update({ where: { id: line.id }, data: { metadata: asJson({ ...metadata, creationReference: reference, creationOutcome: "CREATING" }) } });
        try {
          await input.assertLease();
          response = await contaAzulRequest<unknown>(destinationClientId, directEndpoint, { method: "POST", body: JSON.stringify(directPayload) });
        } catch (error) {
          const status = contaAzulErrorStatus(error);
          if (status === 404 || status === 405) { await input.assertLease(); response = await contaAzulRequest<unknown>(destinationClientId, legacyEndpoint, { method: "POST", body: JSON.stringify(buildFinancialEventPayload(payloadInput)) }); }
          else throw error;
        }
      }
      const protocolId = protocolIdFrom(response);
      const eventId = financialEventIdFromCreation(response);
      const installmentId = recoveredInstallmentId || installmentIdFromCreation(response);
      if (!protocolId && !eventId && !installmentId) {
        throw new Error("O Conta Azul não devolveu o identificador do lançamento criado.");
      }
      await prisma.contaAzulFinancialExportLine.update({
        where: { id: line.id },
        data: {
          status: "CREATED",
          contaAzulCategoryId: category.value,
          contaAzulCostCenterId: costCenter?.value || null,
          externalProtocolId: protocolId,
          externalEventId: eventId,
          externalInstallmentId: installmentId,
          metadata: asJson({ ...metadata, creationReference: reference, creationOutcome: "CREATED" }),
          lastError: null,
        },
      });
    } catch (error) {
      const status = contaAzulErrorStatus(error);
      await prisma.contaAzulFinancialExportLine.update({ where: { id: line.id }, data: {
        status: "FAILED", metadata: asJson({ ...metadata, creationReference: reference, creationOutcome: status !== null && [400, 401, 403, 404, 405, 422].includes(status) ? "REJECTED" : "UNCERTAIN" }),
        lastError: lineFailureMessage(line, error),
      } });
    }
    // Limite oficial: 10 requisições por segundo por conta conectada.
    await sleep(120);
  }
}

async function settleCreatedLines(input: {
  clientId: string;
  exportId: string;
  financialAccountId: string;
  settleRequested: boolean;
  assertLease: () => Promise<void>;
}) {
  const created = await prisma.contaAzulFinancialExportLine.findMany({
    where: {
      exportId: input.exportId,
      OR: [
        { status: "CREATED" },
        { status: "FAILED", externalProtocolId: { not: null } },
        { status: "FAILED", externalEventId: { not: null } },
        { status: "FAILED", externalInstallmentId: { not: null } },
      ],
    },
    orderBy: { updatedAt: "asc" },
    take: 5000,
  });

  const work = created.filter((line) => input.settleRequested || !metadataRecord(line.metadata).creationConfirmedAt || line.status === "FAILED").slice(0, 20);
  for (const line of work) {
    await input.assertLease();
    const destinationClientId = exportLineDestinationClient(line.metadata, input.clientId);
    try {
      let eventId = line.externalEventId;
      if (!eventId && line.externalProtocolId) {
        const protocol = await contaAzulRequest<unknown>(
          destinationClientId,
          `/v1/protocolo/${line.externalProtocolId}`,
        ).catch((error) => { if ([404, 410].includes(contaAzulErrorStatus(error) || 0)) return null; throw error; });
        await sleep(120);
        const state = protocolState(protocol);
        if (state === "ERROR") {
          throw new Error(protocolError(protocol) || "O Conta Azul rejeitou o lançamento.");
        }
        if (protocol && state === "PENDING") {
          await sleep(120);
          continue;
        }
        eventId = resourceIdFromProtocol(protocol);
        if (protocol && !eventId) throw new Error("O CA não confirmou o identificador financeiro do protocolo anterior.");
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
            destinationClientId,
            `/v1/financeiro/eventos-financeiros/${eventId}/parcelas`,
          );
          installmentId = installmentIdFrom(installments);
          if (!installmentId) await sleep(500);
        }
      }
      if (!installmentId) {
        const found = await findFinancialInstallment({
          clientId: destinationClientId,
          direction: line.direction,
          competenceDate: line.competenceDate,
          dueDate: line.dueDate,
          description: line.description,
          amount: Number(line.amount),
          financialAccountId: exportLineFinancialAccount(line.metadata, input.financialAccountId),
          eventId, reference: eventId ? undefined : String(metadataRecord(line.metadata).creationReference || "FORTUNO-" + line.lineKey), categoryId: line.contaAzulCategoryId,
        });
        installmentId = found.installmentId;
        if (found.ambiguous) {
          throw new Error("O Conta Azul devolveu mais de uma parcela possível para este lançamento. A retomada foi interrompida para evitar duplicidade.");
        }
      }
      if (!installmentId) throw new Error("O CA ainda não confirmou a parcela deste envio. Nenhum lançamento será recriado automaticamente.");
      const detail = await contaAzulRequest<unknown>(destinationClientId, "/v1/financeiro/eventos-financeiros/parcelas/" + installmentId);
      const confirmed = confirmFinancialInstallment(detail, { direction: line.direction, description: line.description, amount: Number(line.amount), competenceDate: dateOnly(line.competenceDate), dueDate: dateOnly(line.dueDate), financialAccountId: exportLineFinancialAccount(line.metadata, input.financialAccountId), categoryId: line.contaAzulCategoryId });
      if (eventId && eventId !== confirmed.eventId) throw new Error("A parcela no CA pertence a outro lançamento financeiro.");
      eventId = confirmed.eventId;
      const confirmedMetadata = { ...metadataRecord(line.metadata), creationConfirmedAt: new Date().toISOString() };
      await prisma.contaAzulFinancialExportLine.update({ where: { id: line.id }, data: { externalEventId: eventId, externalInstallmentId: installmentId, status: "CREATED", metadata: asJson(confirmedMetadata), lastError: null } });
      if (!input.settleRequested) continue;
      const amount = Number(line.amount);
      const existingSettlements = await contaAzulRequest<unknown>(
        destinationClientId,
        `/v1/financeiro/eventos-financeiros/parcelas/${installmentId}/baixa`,
      );
      await sleep(120);
      const existingSettlementId = confirmFinancialSettlement(existingSettlements, { amount, accountId: exportLineFinancialAccount(line.metadata, input.financialAccountId), date: dateOnly(line.paymentDate || line.dueDate) });
      let settlementId = existingSettlementId;
      if (!settlementId) {
        if (["CREATING", "UNCERTAIN"].includes(String(metadataRecord(line.metadata).settlementOutcome))) throw new Error("A baixa anterior não foi confirmada. Nenhuma nova baixa será enviada automaticamente.");
        await prisma.contaAzulFinancialExportLine.update({ where: { id: line.id }, data: { metadata: asJson({ ...confirmedMetadata, settlementOutcome: "CREATING" }) } });
        await input.assertLease();
        let settlement: unknown;
        try { settlement = await contaAzulRequest<unknown>(destinationClientId, "/v1/financeiro/eventos-financeiros/parcelas/" + installmentId + "/baixa", {
          method: "POST", body: JSON.stringify({ data_pagamento: dateOnly(line.paymentDate || line.dueDate), composicao_valor: { multa: 0, juros: 0, valor_bruto: amount, desconto: 0, taxa: 0 }, conta_financeira: exportLineFinancialAccount(line.metadata, input.financialAccountId), metodo_pagamento: "OUTRO", observacao: "Baixa Fortuno - " + line.lineKey }),
        }); } catch (error) {
          const status = contaAzulErrorStatus(error);
          await prisma.contaAzulFinancialExportLine.update({ where: { id: line.id }, data: { metadata: asJson({ ...confirmedMetadata, settlementOutcome: status !== null && [400, 401, 403, 404, 405, 422].includes(status) ? "REJECTED" : "UNCERTAIN" }) } });
          throw error;
        }
        settlementId = installmentIdFrom(settlement);
        if (!settlementId) throw new Error("O CA não devolveu o identificador da baixa. Confira o andamento antes de retomar.");
      }
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
          lastError: lineFailureMessage(line, error),
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

  let incoming = await request.json().catch(() => null);
  if (incoming && typeof incoming.resumeExportId === "string" && incoming.confirmation === "ENVIAR AO CA") {
    const saved = await prisma.contaAzulFinancialExport.findFirst({ where: { id: incoming.resumeExportId, organizationId: member.organizationId }, include: { lines: { orderBy: { createdAt: "asc" }, take: 5000 } } });
    if (!saved) return NextResponse.json({ error: "Envio não encontrado." }, { status: 404 });
    const metadata = metadataRecord(saved.metadata);
    if (typeof metadata.originalSourceKey !== "string" || saved.lines.some((line) => typeof metadataRecord(line.metadata).originalLineKey !== "string")) return NextResponse.json({ error: "Os dados originais deste envio não estão completos. Reabra a revisão do arquivo original." }, { status: 409 });
    const useLineAccounts = Boolean(metadata.useLineAccounts);
    incoming = { clientId: saved.clientId, module: saved.module, sourceKey: metadata.originalSourceKey, sourceName: saved.sourceName, contactId: saved.contactId, contactName: saved.contactName, counterpartyHint: saved.contactName || saved.financialAccountName, financialAccountId: saved.financialAccountId, financialAccountName: saved.financialAccountName, settle: saved.settleRequested, useLineAccounts,
      lines: saved.lines.map((line) => ({ lineKey: String(metadataRecord(line.metadata).originalLineKey), direction: line.direction, competenceDate: dateOnly(line.competenceDate), dueDate: dateOnly(line.dueDate), paymentDate: line.paymentDate ? dateOnly(line.paymentDate) : null, description: line.description, amount: Number(line.amount), categoryName: line.categoryName, costCenterName: line.costCenterName, observation: String(metadataRecord(line.metadata).observation || ""),
        ...(useLineAccounts ? { financialAccountId: exportLineFinancialAccount(line.metadata, saved.financialAccountId), destinationClientId: exportLineDestinationClient(line.metadata, saved.clientId) } : {}),
      })),
    };
  }
  const parsed = payloadSchema.safeParse(incoming);
  if (!parsed.success) {
    return NextResponse.json({ error: "Revise os dados do envio ao Conta Azul." }, { status: 400 });
  }
  const requestedBody = parsed.data;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  if (requestedBody.settle && requestedBody.lines.some((line) => (line.paymentDate || line.dueDate) > today)) return NextResponse.json({ error: "A data de pagamento não pode ser futura. Envie como pendente ou informe a data real do pagamento." }, { status: 400 });
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

  const destinationIds = [...new Set(requestedBody.lines.map((line) => allocationClientId(line, requestedBody.clientId)))];
  const destinationClients = new Map([[client.id, client]]);
  // Valide todos os destinos antes de qualquer chamada externa ou criação de contato.
  for (const destinationId of destinationIds) {
    if (destinationId === client.id) continue;
    const destination = await findAuthorizedClient(member, destinationId);
    if (!destination) return NextResponse.json({ error: "Cadastro de destino não encontrado ou não autorizado." }, { status: 404 });
    const destinationConnection = await prisma.contaAzulConnection.findFirst({
      where: { clientId: destinationId, organizationId: member.organizationId, active: true, status: "CONNECTED" }, select: { id: true },
    });
    if (!destinationConnection) return NextResponse.json({ error: `Conecte o cadastro de destino ${destination.name} ao Conta Azul antes de enviar.` }, { status: 400 });
    destinationClients.set(destinationId, destination);
  }
  const leaseToken = crypto.randomUUID();
  const deadline = Date.now() + 250000;
  await prisma.documentImportDispatchLease.upsert({ where: { clientId: requestedBody.clientId }, create: { clientId: requestedBody.clientId, organizationId: member.organizationId, token: "", expiresAt: new Date(0) }, update: {} });
  const locked = await prisma.documentImportDispatchLease.updateMany({ where: { clientId: requestedBody.clientId, organizationId: member.organizationId, expiresAt: { lte: new Date() } }, data: { token: leaseToken, expiresAt: new Date(Date.now() + 10 * 60000) } });
  if (!locked.count) return NextResponse.json({ error: "Já há um envio desta empresa em andamento. Aguarde e confira o histórico antes de retomar." }, { status: 409 });
  async function assertLease() {
    if (Date.now() > deadline || !await prisma.documentImportDispatchLease.findFirst({ where: { clientId: requestedBody.clientId, organizationId: member!.organizationId, token: leaseToken, expiresAt: { gt: new Date() } } })) throw new Error("O processamento foi pausado. Confira o histórico e retome o mesmo envio.");
  }
  try {
  const existing = await prisma.contaAzulFinancialExport.findUnique({
    where: { clientId_module_sourceKey: { clientId: requestedBody.clientId, module: requestedBody.module, sourceKey: stableHash(`${requestedBody.module}|${requestedBody.sourceKey}`) } }, include: { lines: true },
  });
  const resumeError = existing && exportResumeError(existing, requestedBody);
  if (resumeError) return NextResponse.json({ error: resumeError + " Consulte Envios ao CA para ver a tentativa original e o motivo da falha." }, { status: 409 });

  const destinations = new Map<string, ExportClientContext>();
  try {
    if (requestedBody.useLineAccounts) {
      for (const destinationId of destinationIds) {
        const destination = destinationClients.get(destinationId)!;
        const destinationLines = requestedBody.lines.filter((line) => allocationClientId(line, requestedBody.clientId) === destinationId);
        const accountsBody = await contaAzulRequest<unknown>(destinationId, "/v1/conta-financeira?pagina=1&tamanho_pagina=1000&apenas_ativo=true");
        const accounts = contaAzulOptions(apiItems(accountsBody).filter((account) => account.ativo !== false));
        if (invalidAccountAllocationLines(destinationLines, accounts).length) return NextResponse.json({ error: `Existem lançamentos sem conta ativa válida no cadastro ${destination.name}. Revise o rateio antes de enviar.` }, { status: 400 });
        destinationLines.forEach((line) => {
          line.destinationClientId = destinationId;
          line.destinationClientName = destination.name;
          line.financialAccountName = accounts.find((account) => account.value === line.financialAccountId)!.label;
        });
      }
      requestedBody.financialAccountName = requestedBody.lines[0].financialAccountName || null;
    }
    if (!requestedBody.useLineAccounts) {
      const accounts = contaAzulOptions(apiItems(await contaAzulRequest<unknown>(requestedBody.clientId, "/v1/conta-financeira?pagina=1&tamanho_pagina=1000&apenas_ativo=true")).filter((item) => item.ativo !== false));
      const account = accounts.find((item) => item.value === requestedBody.financialAccountId);
      if (!account) return NextResponse.json({ error: "A conta selecionada não está ativa no CA desta empresa. Revise o destino antes de enviar." }, { status: 400 });
      requestedBody.financialAccountName = account.label;
    }
    const unresolvedCategories: string[] = [], unresolvedCostCenters: string[] = [];
    for (const destinationId of destinationIds) {
      const categories = contaAzulOptions(await contaAzulRequest<unknown>(destinationId, "/v1/categorias?pagina=1&tamanho_pagina=1000"));
      const costCenters = contaAzulOptions(await contaAzulRequest<unknown>(destinationId, "/v1/centro-de-custo?pagina=1&tamanho_pagina=1000"));
      destinations.set(destinationId, { categories, costCenters, contactIds: { PAYABLE: "", RECEIVABLE: "" } });
      const prefix = requestedBody.useLineAccounts ? `${destinationClients.get(destinationId)!.name}: ` : "";
      for (const line of requestedBody.lines.filter((item) => allocationClientId(item, requestedBody.clientId) === destinationId)) {
        if (!findContaAzulOption(categories, line.categoryName, line.direction === "RECEIVABLE" ? "RECEITA" : "DESPESA")) unresolvedCategories.push(prefix + line.categoryName);
        if (line.costCenterName && !findContaAzulOption(costCenters, line.costCenterName)) unresolvedCostCenters.push(prefix + line.costCenterName);
      }
    }
    if (unresolvedCategories.length || unresolvedCostCenters.length) return NextResponse.json({
      error: "Existem classificações que não foram localizadas no Conta Azul do cadastro de destino.",
      unresolvedCategories: [...new Set(unresolvedCategories)], unresolvedCostCenters: [...new Set(unresolvedCostCenters)],
    }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível validar os cadastros do rateio." }, { status: 502 });
  }

  let body: ResolvedPayload;
  try {
    let primaryContact: { value: string; label: string } | null = null;
    for (const destinationId of destinationIds) {
      const directions = [...new Set(requestedBody.lines.filter((line) => allocationClientId(line, requestedBody.clientId) === destinationId).map((line) => line.direction))];
      for (const direction of directions) {
        const technicalContact = await resolveTechnicalContact(
          destinationId,
          requestedBody.module,
          direction,
          requestedBody.counterpartyHint || requestedBody.financialAccountName,
          !requestedBody.useLineAccounts && direction === directions[0] ? requestedBody.contactId : null,
          !requestedBody.useLineAccounts && direction === directions[0] ? requestedBody.contactName : null,
        );
        destinations.get(destinationId)!.contactIds[direction] = technicalContact.value;
        if (!primaryContact) primaryContact = technicalContact;
      }
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
  const racedResumeError = exportResumeError(exportBatch, body);
  if (racedResumeError) return NextResponse.json({ error: racedResumeError }, { status: 409 });
  if (exportBatch.contactId !== body.contactId) {
    await prisma.contaAzulFinancialExport.update({
      where: { id: exportBatch.id },
      data: {
        contactId: body.contactId,
        contactName: body.contactName || null,
      },
    });
  }
  await createPendingLines({
    clientId: body.clientId,
    exportId: exportBatch.id,
    financialAccountId: body.financialAccountId,
    destinations, assertLease,
  });
  {
    await settleCreatedLines({
      clientId: body.clientId,
      exportId: exportBatch.id,
      financialAccountId: body.financialAccountId, settleRequested: body.settle, assertLease,
    });
  }

  const grouped = await prisma.contaAzulFinancialExportLine.groupBy({
    by: ["status"],
    where: { exportId: exportBatch.id },
    _count: { _all: true },
  });
  const counts = { PENDING: 0, CREATED: 0, SETTLED: 0, FAILED: 0 };
  for (const item of grouped) counts[item.status] = item._count._all;
  const unconfirmed = body.settle ? [] : (await prisma.contaAzulFinancialExportLine.findMany({ where: { exportId: exportBatch.id, status: "CREATED" }, select: { metadata: true }, take: 5000 })).filter((line) => !metadataRecord(line.metadata).creationConfirmedAt);
  const done = unconfirmed.length === 0 && counts.PENDING === 0
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
    alreadyRecorded: done && existing?.status === "COMPLETED",
    message: done
      ? existing?.status === "COMPLETED" ? "Este envio já tem conclusão registrada no Hub. Use Conferir no CA no histórico para verificar os lançamentos atuais." : body.settle
        ? "Todos os lançamentos foram criados e baixados no Conta Azul."
        : "Todos os lançamentos foram criados como pendentes no Conta Azul."
      : firstFailure?.lastError || "O Conta Azul ainda está processando o envio. O Fortuno Hub continuará automaticamente.",
  });
  } finally {
    await prisma.documentImportDispatchLease.updateMany({ where: { clientId: requestedBody.clientId, organizationId: member.organizationId, token: leaseToken }, data: { expiresAt: new Date(0) } });
  }

}
