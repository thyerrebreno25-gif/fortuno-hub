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

export type GetnetSourceTotals = {
  rows: number | null;
  gross: number | null;
  fees: number | null;
  net: number | null;
};

type ParseGetnetOptions = {
  readingRules?: AcquirerReadingRule[];
};

const REQUIRED_HEADERS = [
  "estabelecimento comercial",
  "data de vencimento",
  "bandeira / modalidade",
  "tipo de lancamento",
  "lancamento",
  "valor liquido",
  "data da venda",
  "valor da venda",
  "parcelas",
  "valor da parcela",
  "descontos",
  "valor liquido da parcela",
];

const DETECTION_HEADERS = [
  "ec centralizador",
  "data de vencimento",
  "bandeira / modalidade",
  "tipo de lancamento",
  "lancamento",
  "valor da parcela",
  "descontos",
];

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

function headersAt(values: unknown[]) {
  return new Set(values.map(normalize));
}

function findHeaderIndex(matrix: unknown[][]) {
  return matrix.findIndex((values) => {
    const headers = headersAt(values);
    return DETECTION_HEADERS.every((header) => headers.has(header));
  });
}

export function isGetnetDetailedSheet(
  sheetName: string,
  matrix: unknown[][],
) {
  return normalize(sheetName).includes("detalhado") && findHeaderIndex(matrix) >= 0;
}

function validateHeaders(headers: unknown[]) {
  const available = headersAt(headers);
  const missing = REQUIRED_HEADERS.filter((header) => !available.has(header));
  if (missing.length > 0) {
    throw new Error(
      `A aba Detalhado da GETNET não possui todas as colunas obrigatórias. Ausentes: ${missing.join(", ")}.`,
    );
  }
}

function transactionType(
  value: unknown,
): NonNullable<ParsedAcquirerLine["transactionType"]> {
  const normalized = normalize(value);
  if (normalized.includes("pix")) return "PIX";
  if (normalized === "debit" || normalized.includes("debito")) return "DEBIT";
  if (normalized.includes("voucher")) return "VOUCHER";
  if (
    normalized === "credit"
    || normalized.includes("credito")
    || normalized.includes("parcelad")
  ) {
    return "CREDIT";
  }
  return "OTHER";
}

function displayBrand(value: unknown) {
  const normalized = normalize(value);
  if (normalized.includes("mastercard")) return "Mastercard";
  if (normalized.includes("visa")) return "Visa";
  if (normalized.includes("elo")) return "Elo";
  if (normalized.includes("hipercard")) return "Hipercard";
  if (normalized.includes("american express") || normalized.includes("amex")) return "Amex";
  if (normalized.includes("cabal")) return "Cabal";
  if (normalized.includes("pix")) return "PIX";
  return text(value).split(/[\/-]/)[0]?.trim() ?? "";
}

function parseInstallments(value: unknown) {
  const raw = text(value);
  const fraction = raw.match(/(\d+)\s*(?:de|\/|-)\s*(\d+)/i);
  if (fraction) {
    return {
      current: Math.max(1, Number(fraction[1])),
      total: Math.max(1, Number(fraction[2])),
    };
  }
  const simple = raw.match(/\d+/);
  const total = simple ? Math.max(1, Number(simple[0])) : 1;
  return { current: 1, total };
}

function normalizeBrand(value: unknown) {
  return normalize(value).replace(/[^a-z0-9]/g, "").toUpperCase();
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
    transactionType(rate.modality) === modality
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
  if (/cancelamento|venda cancelada/.test(normalized)) {
    return { eventType: "CANCELLATION", feeCategory: "CANCELLATION", sign: -1 };
  }
  if (/aluguel|maquin|terminal|equipamento|mensalidade/.test(normalized)) {
    return { eventType: "ADJUSTMENT", feeCategory: "EQUIPMENT", sign: -1 };
  }
  if (/antecip|cessao|negociacao/.test(normalized)) {
    return { eventType: "ANTICIPATION", feeCategory: "ANTICIPATION", sign: -1 };
  }
  if (/credito|reversao|devolucao/.test(normalized)) {
    return { eventType: "ADJUSTMENT", feeCategory: "ADJUSTMENT", sign: 1 };
  }
  if (/debito|retencao|bloqueio|penhora|gravame/.test(normalized)) {
    return { eventType: "ADJUSTMENT", feeCategory: "ADJUSTMENT", sign: -1 };
  }
  return { eventType: "ADJUSTMENT", feeCategory: "OTHER", sign: 0 };
}

function isStructuralRow(type: string, launch: string) {
  const content = normalize(`${type} ${launch}`);
  return content.includes("saldo anterior")
    || content.includes("pagamento realizado")
    || content.includes("valor liquidado (r$)");
}

function isSaleRow(type: string, launch: string) {
  return normalize(type) === "vendas" || normalize(launch).startsWith("venda");
}

function isAnticipated(row: Row, type: string, launch: string) {
  const institution = text(get(row, "instituição negociadora"));
  const contract = text(get(row, "contrato registradora"));
  return Boolean(institution)
    || Boolean(contract && contract !== "0")
    || /antecip|cessao|negociacao/.test(normalize(`${type} ${launch}`));
}

export async function parseGetnetWorkbook(
  file: File,
  categories: Categories,
  manualPaymentDate: string,
  contractedRates: ContractedRate[],
  options: ParseGetnetOptions = {},
): Promise<{
  lines: ParsedAcquirerLine[];
  processedSheets: string[];
  sourceRows: number;
  instructionSummary: ReadingInstructionSummary;
  sourceTotals: GetnetSourceTotals;
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
  let sourceSales = 0;
  let sourceGross = 0;
  let sourceFees = 0;
  let sourceCalculatedNet = 0;
  let sourceDeclaredNet = 0;
  let hasDeclaredNet = false;
  let id = 1;

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
    if (!isGetnetDetailedSheet(sheetName, matrix)) continue;

    const headerIndex = findHeaderIndex(matrix);
    const headers = matrix[headerIndex] ?? [];
    validateHeaders(headers);
    processedSheets.push(sheetName);

    let sheetDeclaredNet = 0;
    let sheetHasDeclaredNet = false;

    matrix.slice(headerIndex + 1).forEach((values, offset) => {
      if (!values.some((value) => value !== null && value !== "")) return;
      const row = record(headers, values);
      const centralizer = normalize(get(row, "ec centralizador"));

      if (centralizer === "total") {
        sheetDeclaredNet = number(get(row, "valor liquidado"));
        sheetHasDeclaredNet = true;
        return;
      }
      if (centralizer === "total recebido") return;

      const launchType = text(get(row, "tipo de lançamento"));
      const launch = text(get(row, "lançamento"));
      if (!launchType && !launch) return;
      if (isStructuralRow(launchType, launch)) return;

      sourceRows += 1;
      const sale = isSaleRow(launchType, launch);
      const dueDate = date(get(row, "data de vencimento")) || manualPaymentDate;
      const paymentDate = dueDate || manualPaymentDate;
      const saleDate = date(get(row, "data da venda")) || paymentDate;
      const brandModality = get(row, "bandeira / modalidade");
      const modality = transactionType(`${text(brandModality)} ${launch}`);
      const brand = modality === "PIX" ? "PIX" : displayBrand(brandModality);
      const installments = parseInstallments(get(row, "parcelas"));
      const establishment = text(get(row, "estabelecimento comercial"));
      const nsu = text(get(row, "número comprovante de venda (nsu)"));
      const authorization = text(get(row, "autorização"));
      const terminal = text(get(row, "terminal lógico"));
      const anticipated = isAnticipated(row, launchType, launch);

      const evaluation = evaluateReadingInstructions(row, sheetName, readingRules);
      evaluation.matchedRuleIds.forEach((ruleId) => {
        matchesByRule[ruleId] = (matchesByRule[ruleId] ?? 0) + 1;
      });
      if (evaluation.excluded) {
        excludedRows += 1;
        evaluation.exclusionRuleIds.forEach((ruleId) => {
          exclusionsByRule[ruleId] = (exclusionsByRule[ruleId] ?? 0) + 1;
        });
      }

      const sourceRow = headerIndex + offset + 2;
      const descriptor = [
        brand,
        modality === "CREDIT"
          ? installments.total > 1 ? "Crédito parcelado" : "Crédito à vista"
          : modality === "DEBIT" ? "Débito"
            : modality === "PIX" ? "PIX"
              : modality === "VOUCHER" ? "Voucher" : "Outro",
        installments.total > 1 ? `parcela ${installments.current}/${installments.total}` : "",
        establishment ? `EC ${establishment}` : "",
        nsu ? `NSU ${nsu}` : "",
        authorization ? `aut. ${authorization}` : "",
        terminal ? `terminal ${terminal}` : "",
      ].filter(Boolean).join(" - ");

      if (sale) {
        const installmentGross = number(get(row, "valor da parcela"));
        const fullSaleGross = number(get(row, "valor da venda"));
        const declaredNet = number(
          get(row, "valor liquido da parcela", "valor líquido"),
        );
        const gross = Math.abs(
          installmentGross
          || (installments.total <= 1 ? fullSaleGross : 0)
          || declaredNet,
        );
        const declaredFee = Math.abs(number(get(row, "descontos")));
        const totalFee = declaredFee || Math.max(roundMoney(gross - Math.abs(declaredNet)), 0);
        const net = declaredNet || roundMoney(gross - totalFee);
        const chargedRate = gross > 0 && totalFee > 0
          ? Math.abs(totalFee / gross) * 100
          : 0;
        const validation = validateRate(
          chargedRate,
          modality,
          installments.total,
          brand,
          contractedRates,
        );

        sourceSales += 1;
        sourceGross = roundMoney(sourceGross + gross);
        sourceFees = roundMoney(sourceFees + totalFee);
        sourceCalculatedNet = roundMoney(sourceCalculatedNet + net);

        if (evaluation.excluded) return;

        if (gross !== 0) {
          push({
            sourceSheet: sheetName,
            sourceRow,
            eventType: "SALE",
            saleDate,
            dueDate,
            paymentDate,
            description: `VENDA GETNET ${descriptor}`.trim(),
            category: categories.sale,
            amount: roundMoney(gross),
            anticipated,
            status:
              validation.rateValidation === "DIVERGENT" || anticipated
                ? "REVIEW"
                : "OK",
            rateValidation: validation.rateValidation,
            chargedRate: chargedRate || undefined,
            contractedRate: "contractedRate" in validation
              ? validation.contractedRate
              : undefined,
            acquirer: "GETNET",
            transactionType: modality,
            cardBrand: brand || undefined,
            installments: installments.total,
          });
        }

        if (totalFee > 0) {
          push({
            sourceSheet: sheetName,
            sourceRow,
            eventType: "FEE",
            saleDate,
            dueDate,
            paymentDate,
            description: `TAXA MDR GETNET ${descriptor}`.trim(),
            category: categories.fee,
            amount: -roundMoney(totalFee),
            anticipated: false,
            status: "OK",
            rateValidation: "NOT_APPLICABLE",
            chargedRate: chargedRate || undefined,
            acquirer: "GETNET",
            transactionType: modality,
            cardBrand: brand || undefined,
            installments: installments.total,
            feeCategory: "SALE_FEE",
          });
        }

        const parsedNet = roundMoney(gross - totalFee);
        const reconciliationAdjustment = roundMoney(net - parsedNet);
        if (Math.abs(reconciliationAdjustment) > 0.009) {
          push({
            sourceSheet: sheetName,
            sourceRow,
            eventType: "ADJUSTMENT",
            saleDate,
            dueDate,
            paymentDate,
            description: `AJUSTE DE CONCILIAÇÃO GETNET ${descriptor}`.trim(),
            category: categories.adjustment,
            amount: reconciliationAdjustment,
            anticipated: false,
            status: "REVIEW",
            rateValidation: "NOT_APPLICABLE",
            acquirer: "GETNET",
            transactionType: modality,
            cardBrand: brand || undefined,
            installments: installments.total,
            feeCategory: "ADJUSTMENT",
          });
        }
        return;
      }

      const classification = classifyNonSaleEvent(`${launchType} ${launch}`);
      const rawAmount = number(
        get(row, "valor liquido da parcela", "valor líquido", "valor liquidado"),
      );
      const amount = classification.sign === 0
        ? rawAmount
        : classification.sign * Math.abs(rawAmount);
      if (Math.abs(amount) <= 0.009) return;
      sourceCalculatedNet = roundMoney(sourceCalculatedNet + amount);
      if (evaluation.excluded) return;

      push({
        sourceSheet: sheetName,
        sourceRow,
        eventType: classification.eventType,
        saleDate,
        dueDate,
        paymentDate,
        description: `${launchType.toUpperCase()} GETNET ${descriptor}`.trim(),
        category: categoryForEvent(
          classification.eventType,
          classification.feeCategory,
          categories,
        ),
        amount: roundMoney(amount),
        anticipated: classification.eventType === "ANTICIPATION",
        status: classification.feeCategory === "OTHER" ? "REVIEW" : "OK",
        rateValidation: "NOT_APPLICABLE",
        acquirer: "GETNET",
        transactionType: modality,
        cardBrand: brand || undefined,
        installments: installments.total,
        feeCategory: classification.feeCategory,
      });
    });

    if (sheetHasDeclaredNet) {
      sourceDeclaredNet = roundMoney(sourceDeclaredNet + sheetDeclaredNet);
      hasDeclaredNet = true;
    }
  }

  if (processedSheets.length === 0) {
    throw new Error(
      "O arquivo não possui a aba Detalhado com o cabeçalho esperado do relatório de recebíveis da GETNET.",
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
    sourceTotals: {
      rows: sourceSales || null,
      gross: sourceSales ? roundMoney(sourceGross) : null,
      fees: sourceSales ? roundMoney(sourceFees) : null,
      net: hasDeclaredNet
        ? roundMoney(sourceDeclaredNet)
        : sourceRows ? roundMoney(sourceCalculatedNet) : null,
    },
  };
}
