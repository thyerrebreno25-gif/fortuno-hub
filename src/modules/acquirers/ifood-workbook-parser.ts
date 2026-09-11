import * as XLSX from "xlsx";
import {
  evaluateReadingInstructions,
  type AcquirerReadingRule,
} from "./reading-instructions";
import type {
  Categories,
  ParsedAcquirerLine,
  ReadingInstructionSummary,
  RedeSourceTotals,
} from "./rede-workbook-parser";

type ParseIfoodOptions = {
  readingRules?: AcquirerReadingRule[];
};

type Row = Record<string, unknown>;

export type IfoodPaymentBatch = {
  paymentDate: string;
  periodStart: string;
  periodEnd: string;
  sourceRows: number;
  gross: number;
  fees: number;
  adjustments: number;
  cancellations: number;
  net: number;
  declaredNet: number;
  difference: number;
};

type MutableBatch = Omit<IfoodPaymentBatch, "declaredNet" | "difference"> & {
  declaredBalances: Map<string, number>;
  lineIndexes: number[];
};

const REQUIRED_HEADERS = [
  "fato_gerador",
  "tipo_lancamento",
  "descricao_lancamento",
  "valor",
  "data_criacao_pedido_associado",
  "data_repasse_esperada",
  "valor_transacao",
  "data_apuracao_inicio",
  "data_apuracao_fim",
  "id_saldo",
];

const normalize = (value: unknown) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/\u00a0/g, " ")
  .trim()
  .toLowerCase();

const normalizeHeader = (value: unknown) => normalize(value)
  .replace(/[^a-z0-9]+/g, "_")
  .replace(/^_+|_+$/g, "");

const text = (value: unknown) => String(value ?? "").trim();

const number = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = text(value);
  if (!raw || raw === "-") return 0;
  const parsed = Number(raw
    .replace(/R\$\s?/gi, "")
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
};

const roundMoney = (value: number) => Math.round(value * 100) / 100;

const dateOnly = (value: unknown): string => {
  if (!value || value === "-") return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
    }
  }
  const raw = text(value);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  return br ? `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}` : "";
};

function headersAt(values: unknown[]) {
  return new Set(values.map(normalizeHeader));
}

function findHeaderIndex(matrix: unknown[][]) {
  return matrix.findIndex((values) => {
    const headers = headersAt(values);
    return REQUIRED_HEADERS.every((header) => headers.has(header));
  });
}

export function isIfoodReconciliationSheet(matrix: unknown[][]) {
  return findHeaderIndex(matrix) >= 0;
}

function record(headers: unknown[], values: unknown[]): Row {
  return Object.fromEntries(
    headers.map((header, index) => [normalizeHeader(header), values[index]]),
  );
}

function transactionType(value: unknown): ParsedAcquirerLine["transactionType"] {
  const normalized = normalize(value);
  if (normalized.includes("pix")) return "PIX";
  if (normalized.includes("debito")) return "DEBIT";
  if (normalized.includes("credito")) return "CREDIT";
  if (/vale|voucher/.test(normalized)) return "VOUCHER";
  return "OTHER";
}

function cardBrand(value: unknown) {
  const normalized = normalizeHeader(value);
  const known: Record<string, string> = {
    visa: "Visa",
    visa_electron: "Visa Electron",
    mastercard: "Mastercard",
    mastercard_maestro: "Mastercard Maestro",
    elo: "Elo",
    elo_debit: "Elo",
    amex: "Amex",
    nubank: "Nubank",
    ifood_meal_voucher: "iFood Benefícios",
    ifood_paybnplcredit_voucher: "iFood Voucher",
    movile_pay: "Movile Pay",
  };
  return known[normalized] ?? (text(value) || undefined);
}

function classify(row: Row, amount: number): {
  eventType: ParsedAcquirerLine["eventType"];
  feeCategory?: ParsedAcquirerLine["feeCategory"];
  recognized: boolean;
} {
  const type = normalize(row.tipo_lancamento);
  const description = normalize(row.descricao_lancamento);
  const trigger = normalize(row.fato_gerador);
  const content = `${trigger} ${type} ${description}`;

  if (amount > 0 && type === "entrada financeira") {
    return { eventType: "SALE", recognized: true };
  }
  if (/chargeback|contestacao/.test(content)) {
    return { eventType: "CHARGEBACK", feeCategory: "CHARGEBACK", recognized: true };
  }
  if (/cancelamento|venda cancelada/.test(content)) {
    return { eventType: "CANCELLATION", feeCategory: "CANCELLATION", recognized: true };
  }
  if (
    amount < 0
    && (
      /cobranca|retencao/.test(type)
      || /taxa|comissao|mensalidade|entrega/.test(description)
    )
  ) {
    return {
      eventType: "FEE",
      feeCategory: description.includes("mensalidade") ? "OTHER" : "SALE_FEE",
      recognized: true,
    };
  }
  if (/subsidio|reembolso|ajuste|estorno/.test(content)) {
    return { eventType: "ADJUSTMENT", feeCategory: "ADJUSTMENT", recognized: true };
  }
  return { eventType: "ADJUSTMENT", feeCategory: "OTHER", recognized: false };
}

function categoryFor(
  eventType: ParsedAcquirerLine["eventType"],
  categories: Categories,
) {
  if (eventType === "SALE") return categories.sale;
  if (eventType === "FEE") return categories.fee;
  if (eventType === "CANCELLATION") return categories.cancellation;
  if (eventType === "CHARGEBACK") return categories.chargeback;
  if (eventType === "ANTICIPATION") return categories.anticipation;
  return categories.adjustment;
}

function metadata(row: Row) {
  return Object.fromEntries(
    Object.entries(row).flatMap(([key, value]) => {
      if (value === undefined || value === null || value === "") return [];
      if (value instanceof Date) return [[key, value.toISOString()]];
      if (["string", "number", "boolean"].includes(typeof value)) {
        return [[key, value as string | number | boolean]];
      }
      return [];
    }),
  );
}

export async function parseIfoodWorkbook(
  file: File,
  categories: Categories,
  manualPaymentDate: string,
  options: ParseIfoodOptions = {},
): Promise<{
  lines: ParsedAcquirerLine[];
  processedSheets: string[];
  sourceRows: number;
  instructionSummary: ReadingInstructionSummary;
  sourceTotals: RedeSourceTotals;
  paymentBatches: IfoodPaymentBatch[];
}> {
  const workbook = XLSX.read(await file.arrayBuffer(), {
    type: "array",
    cellDates: true,
  });
  const readingRules = options.readingRules ?? [];
  const lines: ParsedAcquirerLine[] = [];
  const processedSheets: string[] = [];
  const matchesByRule = Object.fromEntries(readingRules.map((rule) => [rule.id, 0]));
  const exclusionsByRule = Object.fromEntries(readingRules.map((rule) => [rule.id, 0]));
  const batches = new Map<string, MutableBatch>();
  const seenRows = new Set<string>();
  let excludedRows = 0;
  let sourceRows = 0;
  let sourceGross = 0;
  let sourceFees = 0;
  let sourceAdjustments = 0;
  let sourceCancellations = 0;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: true,
    });
    const headerIndex = findHeaderIndex(matrix);
    if (headerIndex < 0) continue;

    processedSheets.push(sheetName);
    const headers = matrix[headerIndex];
    matrix.slice(headerIndex + 1).forEach((values, offset) => {
      if (!values.some((value) => value !== null && value !== "")) return;
      const row = record(headers, values);
      const amount = roundMoney(number(row.valor));
      const paymentDate = dateOnly(row.data_repasse_esperada) || manualPaymentDate;
      const sourceRow = headerIndex + offset + 2;
      if (Math.abs(amount) <= 0.009 || !paymentDate) return;

      const rowSignature = JSON.stringify(values.map((value) =>
        value instanceof Date ? value.toISOString() : value));
      if (seenRows.has(rowSignature)) return;
      seenRows.add(rowSignature);

      const classification = classify(row, amount);
      const saleDate = dateOnly(row.data_criacao_pedido_associado)
        || dateOnly(row.data_faturamento)
        || dateOnly(row.data_apuracao_fim)
        || paymentDate;
      const periodStart = dateOnly(row.data_apuracao_inicio);
      const periodEnd = dateOnly(row.data_apuracao_fim);
      const order = text(row.pedido_associado_ifood_curto)
        || text(row.pedido_associado_ifood);
      const description = text(row.descricao_lancamento)
        || text(row.tipo_lancamento)
        || text(row.fato_gerador)
        || "Lançamento";
      const method = transactionType(row.metodo_pagamento);
      const brand = cardBrand(row.bandeira_pagamento);
      const semanticRow: Row = {
        ...row,
        estabelecimento: row.loja_id_curto || row.loja_id,
        bandeira: row.bandeira_pagamento,
        modalidade: row.metodo_pagamento,
        descricao: row.descricao_lancamento,
      };

      sourceRows += 1;
      if (classification.eventType === "SALE") {
        sourceGross = roundMoney(sourceGross + amount);
      } else if (classification.eventType === "FEE" && amount < 0) {
        sourceFees = roundMoney(sourceFees + Math.abs(amount));
      } else if (
        classification.eventType === "CANCELLATION"
        || classification.eventType === "CHARGEBACK"
      ) {
        sourceCancellations = roundMoney(sourceCancellations + Math.abs(amount));
      } else {
        sourceAdjustments = roundMoney(sourceAdjustments + amount);
      }

      const currentBatch = batches.get(paymentDate) ?? {
        paymentDate,
        periodStart,
        periodEnd,
        sourceRows: 0,
        gross: 0,
        fees: 0,
        adjustments: 0,
        cancellations: 0,
        net: 0,
        declaredBalances: new Map<string, number>(),
        lineIndexes: [],
      };
      currentBatch.periodStart = !currentBatch.periodStart
        || (periodStart && periodStart < currentBatch.periodStart)
        ? periodStart
        : currentBatch.periodStart;
      currentBatch.periodEnd = !currentBatch.periodEnd
        || (periodEnd && periodEnd > currentBatch.periodEnd)
        ? periodEnd
        : currentBatch.periodEnd;
      currentBatch.sourceRows += 1;
      currentBatch.net = roundMoney(currentBatch.net + amount);
      if (classification.eventType === "SALE") {
        currentBatch.gross = roundMoney(currentBatch.gross + amount);
      } else if (classification.eventType === "FEE" && amount < 0) {
        currentBatch.fees = roundMoney(currentBatch.fees + Math.abs(amount));
      } else if (
        classification.eventType === "CANCELLATION"
        || classification.eventType === "CHARGEBACK"
      ) {
        currentBatch.cancellations = roundMoney(
          currentBatch.cancellations + Math.abs(amount),
        );
      } else {
        currentBatch.adjustments = roundMoney(currentBatch.adjustments + amount);
      }
      const balanceId = text(row.id_saldo);
      if (balanceId && !currentBatch.declaredBalances.has(balanceId)) {
        currentBatch.declaredBalances.set(balanceId, number(row.valor_transacao));
      }
      batches.set(paymentDate, currentBatch);

      const evaluation = evaluateReadingInstructions(
        semanticRow,
        sheetName,
        readingRules,
      );
      evaluation.matchedRuleIds.forEach((ruleId) => {
        matchesByRule[ruleId] = (matchesByRule[ruleId] ?? 0) + 1;
      });
      if (evaluation.excluded) {
        excludedRows += 1;
        evaluation.exclusionRuleIds.forEach((ruleId) => {
          exclusionsByRule[ruleId] = (exclusionsByRule[ruleId] ?? 0) + 1;
        });
        return;
      }

      const lineIndex = lines.length;
      currentBatch.lineIndexes.push(lineIndex);
      lines.push({
        id: lineIndex + 1,
        sourceSheet: sheetName,
        sourceRow,
        eventType: classification.eventType,
        saleDate,
        dueDate: paymentDate,
        paymentDate,
        description: `IFOOD - ${description}${order ? ` - pedido ${order}` : ""}`,
        category: categoryFor(classification.eventType, categories),
        amount,
        anticipated: false,
        status: classification.recognized ? "OK" : "REVIEW",
        rateValidation: "NOT_APPLICABLE",
        acquirer: "IFOOD",
        transactionType: method,
        cardBrand: brand,
        installments: 1,
        feeCategory: classification.feeCategory,
        sourceMetadata: metadata({
          ...semanticRow,
          competencia_original: row.competencia,
          competencia_extraida: saleDate,
          data_repasse_filtrada: paymentDate,
        }),
      });
    });
  }

  if (processedSheets.length === 0) {
    throw new Error(
      "O arquivo não possui o cabeçalho esperado do Relatório de Conciliação do iFood.",
    );
  }

  const paymentBatches = Array.from(batches.values())
    .map((batch): IfoodPaymentBatch => {
      const declaredNet = roundMoney(
        Array.from(batch.declaredBalances.values())
          .reduce((sum, value) => sum + value, 0),
      );
      const difference = roundMoney(batch.net - declaredNet);
      if (Math.abs(difference) > 0.009) {
        batch.lineIndexes.forEach((lineIndex) => {
          const line = lines[lineIndex];
          if (!line) return;
          line.status = "REVIEW";
          line.sourceMetadata = {
            ...line.sourceMetadata,
            diferenca_lote: difference,
          };
        });
      }
      return {
        paymentDate: batch.paymentDate,
        periodStart: batch.periodStart,
        periodEnd: batch.periodEnd,
        sourceRows: batch.sourceRows,
        gross: batch.gross,
        fees: batch.fees,
        adjustments: batch.adjustments,
        cancellations: batch.cancellations,
        net: batch.net,
        declaredNet,
        difference,
      };
    })
    .sort((left, right) => left.paymentDate.localeCompare(right.paymentDate));

  const calculatedNet = roundMoney(
    sourceGross - sourceFees + sourceAdjustments - sourceCancellations,
  );
  return {
    lines,
    processedSheets,
    sourceRows,
    instructionSummary: {
      rules: readingRules,
      excludedRows,
      matchesByRule,
      exclusionsByRule,
      unmatchedRuleIds: readingRules
        .filter((rule) => (matchesByRule[rule.id] ?? 0) === 0)
        .map((rule) => rule.id),
    },
    sourceTotals: {
      rows: sourceRows || null,
      gross: sourceRows ? sourceGross : null,
      fees: sourceRows ? sourceFees : null,
      net: sourceRows ? calculatedNet : null,
    },
    paymentBatches,
  };
}
