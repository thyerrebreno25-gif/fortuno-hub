import * as XLSX from "xlsx";
import {
  evaluateReadingInstructions,
  type AcquirerReadingRule,
} from "./reading-instructions";
import type {
  Categories,
  ContractedRate,
  FeeCategory,
  ParsedAcquirerLine,
  ReadingInstructionSummary,
} from "./rede-workbook-parser";

type Row = Record<string, unknown>;

export type CieloSourceTotals = {
  rows: number | null;
  gross: number | null;
  fees: number | null;
  net: number | null;
};

type ParseCieloOptions = {
  readingRules?: AcquirerReadingRule[];
};

const normalize = (value: unknown) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/\u00a0/g, " ")
  .trim()
  .toLowerCase();

const text = (value: unknown) => {
  const result = String(value ?? "").trim();
  return result === "-" ? "" : result;
};

const number = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = String(value ?? "").trim();
  if (!raw || raw === "-") return 0;
  const normalized = raw
    .replace(/R\$\s?/gi, "")
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".")
    .replace(/%/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const roundMoney = (value: number) => Math.round(value * 100) / 100;

const date = (value: unknown): string => {
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
  const raw = String(value).trim();
  const br = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (br) return `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : "";
};

function record(headers: unknown[], values: unknown[]): Row {
  return Object.fromEntries(
    headers.map((header, index) => [normalize(header), values[index]]),
  );
}

function get(row: Row, ...keys: string[]) {
  for (const key of keys) {
    const value = row[normalize(key)];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function normalizeModality(
  value: unknown,
): "DEBIT" | "CREDIT" | "PIX" | "VOUCHER" | "OTHER" {
  const normalized = normalize(value);
  if (normalized.includes("pix")) return "PIX";
  if (normalized === "debit" || normalized.includes("debito")) return "DEBIT";
  if (normalized.includes("voucher")) return "VOUCHER";
  if (
    normalized === "credit"
    || normalized.includes("credito")
    || normalized.includes("parcelad")
  ) return "CREDIT";
  return "OTHER";
}

function normalizeBrand(value: unknown) {
  return normalize(value).replace(/[^a-z0-9]/g, "").toUpperCase();
}

function displayBrand(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  const known: Record<string, string> = {
    MASTERCARD: "Mastercard",
    MASTER: "Mastercard",
    VISA: "Visa",
    ELO: "Elo",
    HIPERCARD: "Hipercard",
    AMEX: "Amex",
    AMERICANEXPRESS: "Amex",
    CABAL: "Cabal",
    DINERS: "Diners",
    PIX: "PIX",
  };
  return known[normalizeBrand(raw)] ?? raw;
}

function validateRate(
  chargedRate: number,
  modality: ParsedAcquirerLine["transactionType"],
  installments: number,
  brand: string,
  rates: ContractedRate[],
) {
  if (!chargedRate) return { rateValidation: "NOT_APPLICABLE" as const };
  if (rates.length === 0) return { rateValidation: "NOT_CONFIGURED" as const };

  const paymentForm = modality === "CREDIT" && installments > 1 ? 2 : 1;
  const normalizedBrand = normalizeBrand(brand);
  const candidates = rates.filter((rate) =>
    normalizeModality(rate.modality) === modality
    && (rate.installments == null || Number(rate.installments) === paymentForm),
  );
  const specific = candidates.find(
    (rate) => normalizeBrand(rate.cardBrand) === normalizedBrand,
  );
  const general = candidates.find(
    (rate) => !normalizeBrand(rate.cardBrand) || normalize(rate.cardBrand) === "todas",
  );
  const contracted = specific ?? general;

  if (!contracted) return { rateValidation: "NOT_CONFIGURED" as const };
  const tolerance = Number(contracted.tolerance || 0);
  const contractedRate = Math.round(Number(contracted.rate) * 10000) / 10000;
  const normalizedChargedRate = Math.round(chargedRate * 10000) / 10000;
  return {
    rateValidation:
      Math.abs(normalizedChargedRate - contractedRate) <= tolerance + 0.000001
        ? "MATCH" as const
        : "DIVERGENT" as const,
    contractedRate,
  };
}

function findHeaderIndex(matrix: unknown[][]) {
  return matrix.findIndex((values) => {
    const headers = new Set(values.map(normalize));
    return [
      "data de pagamento",
      "tipo de lancamento",
      "valor bruto",
      "taxa/tarifa",
      "valor liquido",
    ].every((header) => headers.has(header));
  });
}

function readSourceTotals(matrix: unknown[][], headerIndex: number): CieloSourceTotals {
  const labelsIndex = matrix
    .slice(0, Math.max(headerIndex, 0))
    .findIndex((values) => normalize(values[0]) === "quantidade de lancamentos");

  if (labelsIndex < 0 || !matrix[labelsIndex + 1]) {
    return { rows: null, gross: null, fees: null, net: null };
  }

  const values = matrix[labelsIndex + 1];
  return {
    rows: number(values[0]) || null,
    gross: number(values[1]) || null,
    fees: Math.abs(number(values[2])) || null,
    net: number(values[3]) || null,
  };
}

function eventStatus(value: unknown): "OK" | "REVIEW" {
  const normalized = normalize(value);
  return /pago|pagamento manual|baixa por compensacao/.test(normalized)
    && !/rejeitado|agendado|reenviado/.test(normalized)
    ? "OK"
    : "REVIEW";
}

function classifyNonSaleEvent(value: string): {
  eventType: ParsedAcquirerLine["eventType"];
  feeCategory: FeeCategory;
  sign: -1 | 1 | 0;
} {
  const normalized = normalize(value);

  if (/reversao.*(?:contest|chargeback)/.test(normalized)) {
    return { eventType: "ADJUSTMENT", feeCategory: "CHARGEBACK", sign: 1 };
  }
  if (/contest|chargeback/.test(normalized)) {
    return { eventType: "CHARGEBACK", feeCategory: "CHARGEBACK", sign: -1 };
  }
  if (/reversao.*cancel/.test(normalized)) {
    return { eventType: "ADJUSTMENT", feeCategory: "CANCELLATION", sign: 1 };
  }
  if (/cancelamento/.test(normalized)) {
    return { eventType: "CANCELLATION", feeCategory: "CANCELLATION", sign: -1 };
  }
  if (/aluguel|plano cielo|maquin|terminal|equipamento/.test(normalized)) {
    return { eventType: "ADJUSTMENT", feeCategory: "EQUIPMENT", sign: -1 };
  }
  if (/cedid|cessao|negociacao|antecip/.test(normalized)) {
    return { eventType: "ANTICIPATION", feeCategory: "ANTICIPATION", sign: -1 };
  }
  if (/credito|reversao|devolucao de debito|compensacao a credito/.test(normalized)) {
    return { eventType: "ADJUSTMENT", feeCategory: "ADJUSTMENT", sign: 1 };
  }
  if (/debito|gravame|garantia|penhora|compensacao/.test(normalized)) {
    return { eventType: "ADJUSTMENT", feeCategory: "ADJUSTMENT", sign: -1 };
  }
  return { eventType: "ADJUSTMENT", feeCategory: "OTHER", sign: 0 };
}

function isSale(value: string) {
  const normalized = normalize(value);
  return normalized.startsWith("venda")
    || normalized === "pix"
    || normalized.startsWith("recebimento pix");
}

function categoryForEvent(
  eventType: ParsedAcquirerLine["eventType"],
  feeCategory: FeeCategory,
  categories: Categories,
) {
  if (eventType === "SALE") return categories.sale;
  if (eventType === "FEE") return categories.fee;
  if (eventType === "ANTICIPATION") return categories.anticipation;
  if (eventType === "CANCELLATION") return categories.cancellation;
  if (eventType === "CHARGEBACK") return categories.chargeback;
  if (feeCategory === "CANCELLATION") return categories.cancellation;
  if (feeCategory === "CHARGEBACK") return categories.chargeback;
  return categories.adjustment;
}

export async function parseCieloWorkbook(
  file: File,
  categories: Categories,
  manualPaymentDate: string,
  contractedRates: ContractedRate[],
  options: ParseCieloOptions = {},
): Promise<{
  lines: ParsedAcquirerLine[];
  processedSheets: string[];
  sourceRows: number;
  instructionSummary: ReadingInstructionSummary;
  sourceTotals: CieloSourceTotals;
}> {
  const workbook = XLSX.read(await file.arrayBuffer(), {
    type: "array",
    cellDates: true,
  });
  const lines: ParsedAcquirerLine[] = [];
  const processedSheets: string[] = [];
  const readingRules = options.readingRules ?? [];
  const matchesByRule = Object.fromEntries(readingRules.map((rule) => [rule.id, 0]));
  const exclusionsByRule = Object.fromEntries(readingRules.map((rule) => [rule.id, 0]));
  let excludedRows = 0;
  let sourceRows = 0;
  let id = 1;
  const sourceTotals: CieloSourceTotals = {
    rows: null,
    gross: null,
    fees: null,
    net: null,
  };

  const push = (line: Omit<ParsedAcquirerLine, "id">) => {
    lines.push({ id: id++, ...line });
  };

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
      raw: true,
    });
    const headerIndex = findHeaderIndex(matrix);
    if (headerIndex < 0) continue;

    processedSheets.push(sheetName);
    const sheetTotals = readSourceTotals(matrix, headerIndex);
    if (sheetTotals.rows != null) sourceTotals.rows = (sourceTotals.rows ?? 0) + sheetTotals.rows;
    if (sheetTotals.gross != null) sourceTotals.gross = roundMoney((sourceTotals.gross ?? 0) + sheetTotals.gross);
    if (sheetTotals.fees != null) sourceTotals.fees = roundMoney((sourceTotals.fees ?? 0) + sheetTotals.fees);
    if (sheetTotals.net != null) sourceTotals.net = roundMoney((sourceTotals.net ?? 0) + sheetTotals.net);

    const headers = matrix[headerIndex] ?? [];
    matrix.slice(headerIndex + 1).forEach((values, offset) => {
      if (!values.some((value) => value !== null && value !== "")) return;
      const row = record(headers, values);
      const launchType = text(get(row, "tipo de lançamento"));
      if (!launchType) return;

      sourceRows += 1;
      const evaluation = evaluateReadingInstructions(row, sheetName, readingRules);
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

      const sourceRow = headerIndex + offset + 2;
      const gross = number(get(row, "valor bruto"));
      const totalFee = Math.abs(number(get(row, "taxa/tarifa")));
      const net = number(get(row, "valor líquido"));
      const paymentDate = date(get(row, "data de pagamento"))
        || date(get(row, "data prevista de pagamento"))
        || manualPaymentDate;
      const dueDate = date(get(row, "data prevista de pagamento")) || paymentDate;
      const saleDate = date(get(row, "data da venda", "data do lançamento")) || paymentDate;
      const status = eventStatus(get(row, "status de pagamento"));
      const paymentForm = get(row, "forma de pagamento");
      const transactionType = normalizeModality(paymentForm || launchType);
      const brand = transactionType === "PIX" ? "PIX" : displayBrand(get(row, "bandeira"));
      const installment = Math.max(1, Math.trunc(number(get(row, "número da parcela")) || 1));
      const totalInstallments = Math.max(
        installment,
        Math.trunc(number(get(row, "quantidade total de parcelas")) || 1),
      );
      const establishment = text(get(row, "estabelecimento"));
      const account = text(get(row, "conta"));
      const bank = text(get(row, "banco"));
      const channel = text(get(row, "canal da venda"));
      const product = text(get(row, "modalidade"));
      const reference = text(
        get(row, "tid", "código da venda", "nsu/doc", "id pix"),
      );
      const descriptor = [
        brand,
        transactionType === "CREDIT"
          ? totalInstallments > 1 ? "Crédito parcelado" : "Crédito à vista"
          : transactionType === "DEBIT" ? "Débito"
            : transactionType === "PIX" ? "PIX"
              : transactionType === "VOUCHER" ? "Voucher" : "Outro",
        totalInstallments > 1 ? `parcela ${installment}/${totalInstallments}` : "",
        establishment ? `EC ${establishment}` : "",
        channel,
        product,
        bank && account ? `${bank} conta ${account}` : "",
        reference ? `ref. ${reference}` : "",
      ].filter(Boolean).join(" - ");

      if (isSale(launchType)) {
        const mdrValue = Math.abs(number(get(row, "valor da taxa administrativa (mdr)")));
        const timingValue = Math.abs(number(get(row, "valor da taxa do prazo de recebimento")));
        const declaredMdrRate = number(get(row, "taxa administrativa (mdr) (%)"));
        const chargedRate = declaredMdrRate > 0
          ? declaredMdrRate
          : gross !== 0 && mdrValue !== 0
            ? Math.abs(mdrValue / gross) * 100
            : totalFee > 0 && gross !== 0
              ? Math.abs(totalFee / gross) * 100
              : 0;
        const validation = validateRate(
          chargedRate,
          transactionType,
          totalInstallments,
          brand,
          contractedRates,
        );

        if (gross !== 0) {
          push({
            sourceSheet: sheetName,
            sourceRow,
            eventType: "SALE",
            saleDate,
            dueDate,
            paymentDate,
            description: `${launchType.toUpperCase()} ${descriptor}`.trim(),
            category: categories.sale,
            amount: Math.abs(gross),
            anticipated: timingValue > 0 || /antecip|receba rapido/.test(normalize(product)),
            status: validation.rateValidation === "DIVERGENT" ? "REVIEW" : status,
            rateValidation: validation.rateValidation,
            chargedRate: chargedRate || undefined,
            contractedRate: "contractedRate" in validation ? validation.contractedRate : undefined,
            acquirer: "CIELO",
            transactionType,
            cardBrand: brand || undefined,
            installments: totalInstallments,
          });
        }

        let remainingFee = totalFee;
        const effectiveMdr = Math.min(mdrValue || (timingValue === 0 ? totalFee : 0), remainingFee);
        if (effectiveMdr > 0) {
          push({
            sourceSheet: sheetName,
            sourceRow,
            eventType: "FEE",
            saleDate,
            dueDate,
            paymentDate,
            description: `TAXA MDR CIELO ${descriptor}`.trim(),
            category: categories.fee,
            amount: -roundMoney(effectiveMdr),
            anticipated: false,
            status,
            rateValidation: "NOT_APPLICABLE",
            chargedRate: chargedRate || undefined,
            acquirer: "CIELO",
            transactionType,
            cardBrand: brand || undefined,
            installments: totalInstallments,
            feeCategory: "SALE_FEE",
          });
          remainingFee = roundMoney(remainingFee - effectiveMdr);
        }

        const effectiveTiming = Math.min(timingValue, Math.max(remainingFee, 0));
        if (effectiveTiming > 0) {
          push({
            sourceSheet: sheetName,
            sourceRow,
            eventType: "ANTICIPATION",
            saleDate,
            dueDate,
            paymentDate,
            description: `TAXA DO PRAZO DE RECEBIMENTO CIELO ${descriptor}`.trim(),
            category: categories.anticipation,
            amount: -roundMoney(effectiveTiming),
            anticipated: true,
            status,
            rateValidation: "NOT_APPLICABLE",
            acquirer: "CIELO",
            transactionType,
            cardBrand: brand || undefined,
            installments: totalInstallments,
            feeCategory: "ANTICIPATION",
          });
          remainingFee = roundMoney(remainingFee - effectiveTiming);
        }

        if (remainingFee > 0.009) {
          push({
            sourceSheet: sheetName,
            sourceRow,
            eventType: "FEE",
            saleDate,
            dueDate,
            paymentDate,
            description: `OUTRAS TAXAS CIELO ${descriptor}`.trim(),
            category: categories.fee,
            amount: -roundMoney(remainingFee),
            anticipated: false,
            status: "REVIEW",
            rateValidation: "NOT_APPLICABLE",
            acquirer: "CIELO",
            transactionType,
            cardBrand: brand || undefined,
            installments: totalInstallments,
            feeCategory: "OTHER",
          });
        }

        const parsedNet = roundMoney(Math.abs(gross) - totalFee);
        const reconciliationAdjustment = roundMoney(net - parsedNet);
        if (net !== 0 && Math.abs(reconciliationAdjustment) > 0.009) {
          push({
            sourceSheet: sheetName,
            sourceRow,
            eventType: "ADJUSTMENT",
            saleDate,
            dueDate,
            paymentDate,
            description: `AJUSTE DE CONCILIAÇÃO CIELO ${descriptor}`.trim(),
            category: categories.adjustment,
            amount: reconciliationAdjustment,
            anticipated: false,
            status: "REVIEW",
            rateValidation: "NOT_APPLICABLE",
            acquirer: "CIELO",
            transactionType,
            cardBrand: brand || undefined,
            installments: totalInstallments,
            feeCategory: "ADJUSTMENT",
          });
        }
        return;
      }

      const classification = classifyNonSaleEvent(`${launchType} ${text(get(row, "descrição"))}`);
      const rawAmount = net || roundMoney(gross - totalFee) || gross || -totalFee;
      const amount = classification.sign === 0
        ? rawAmount
        : classification.sign * Math.abs(rawAmount);
      if (Math.abs(amount) <= 0.009) return;

      push({
        sourceSheet: sheetName,
        sourceRow,
        eventType: classification.eventType,
        saleDate,
        dueDate,
        paymentDate,
        description: `${launchType.toUpperCase()} ${descriptor}`.trim(),
        category: categoryForEvent(
          classification.eventType,
          classification.feeCategory,
          categories,
        ),
        amount: roundMoney(amount),
        anticipated: classification.eventType === "ANTICIPATION",
        status,
        rateValidation: "NOT_APPLICABLE",
        acquirer: "CIELO",
        transactionType,
        cardBrand: brand || undefined,
        installments: totalInstallments,
        feeCategory: classification.feeCategory,
      });
    });
  }

  if (processedSheets.length === 0) {
    throw new Error(
      "O arquivo não possui o cabeçalho esperado do relatório Recebíveis Detalhado da Cielo.",
    );
  }

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
    sourceTotals,
  };
}
