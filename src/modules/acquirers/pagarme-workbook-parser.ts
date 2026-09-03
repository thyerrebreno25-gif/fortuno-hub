import * as XLSX from "xlsx";
import {
  evaluateReadingInstructions,
  type AcquirerReadingRule,
} from "./reading-instructions";
import type {
  Categories,
  FeeCategory,
  ParsedAcquirerLine,
  ReadingInstructionSummary,
  RedeSourceTotals,
} from "./rede-workbook-parser";

type ParsePagarmeOptions = {
  readingRules?: AcquirerReadingRule[];
};

type SemanticRow = Record<string, unknown>;

const normalize = (value: unknown) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/\uFFFD+/g, "")
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
  const br = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (br) return `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : "";
};

function findHeaderIndex(matrix: unknown[][]) {
  return matrix.findIndex((values) => {
    const headers = values.map(normalize);
    return headers.some((header) => header.includes("id da transa"))
      && headers.some((header) => header.includes("entrada bruta"))
      && headers.some((header) => header.includes("taxa total da opera"))
      && headers.some((header) => header.includes("id do arranjo"));
  });
}

export function isPagarmeMovementSheet(
  sheetName: string,
  matrix: unknown[][],
) {
  const normalizedName = normalize(sheetName).replace(/[^a-z0-9]/g, "");
  return findHeaderIndex(matrix) >= 0
    && (normalizedName.includes("pagarme") || normalizedName.includes("movimenta"));
}

function semanticRow(values: unknown[]): SemanticRow {
  return {
    "data da operação": values[0],
    "tipo da operação": values[1],
    "id da operação": values[2],
    "descrição da operação": values[3],
    "id da transação": values[4],
    parcela: values[5],
    "método de pagamento": values[6],
    "entrada bruta": values[7],
    "saída bruta": values[8],
    "taxa de operação": values[9],
    "taxa de antecipação": values[10],
    "taxa total da operação": values[11],
    "entrada líquida": values[12],
    "saída líquida": values[13],
    "id do arranjo": values[14],
    bandeira: values[3],
    modalidade: values[6],
    descrição: values[3],
  };
}

function displayBrand(value: unknown) {
  const normalized = normalize(value).replace(/[^a-z0-9]/g, "");
  const brands: Record<string, string> = {
    visa: "Visa",
    mastercard: "Mastercard",
    elo: "Elo",
    amex: "Amex",
    americanexpress: "Amex",
    hipercard: "Hipercard",
  };
  return brands[normalized] ?? text(value);
}

function transactionType(value: unknown): ParsedAcquirerLine["transactionType"] {
  const normalized = normalize(value);
  if (normalized.includes("pix")) return "PIX";
  if (normalized.includes("debito")) return "DEBIT";
  if (normalized.includes("voucher")) return "VOUCHER";
  if (/credito|cartao|antecip/.test(normalized)) return "CREDIT";
  return "OTHER";
}

function installments(value: unknown) {
  const match = text(value).match(/(\d+)\s*(?:\/|de)\s*(\d+)/i);
  if (match) return Math.max(Number(match[2]), 1);
  const direct = Number.parseInt(text(value), 10);
  return Number.isFinite(direct) && direct > 0 ? direct : 1;
}

function metadata(row: SemanticRow, extra: Record<string, string | number | boolean | null> = {}) {
  return {
    operationId: text(row["id da operação"]) || null,
    transactionId: text(row["id da transação"]) || null,
    arrangementId: text(row["id do arranjo"]) || null,
    operationType: text(row["tipo da operação"]) || null,
    paymentMethod: text(row["método de pagamento"]) || null,
    ...extra,
  };
}

function categoryForFee(feeCategory: FeeCategory, categories: Categories) {
  return feeCategory === "ANTICIPATION" ? categories.anticipation : categories.fee;
}

export async function parsePagarmeWorkbook(
  file: File,
  categories: Categories,
  manualPaymentDate: string,
  options: ParsePagarmeOptions = {},
): Promise<{
  lines: ParsedAcquirerLine[];
  processedSheets: string[];
  sourceRows: number;
  instructionSummary: ReadingInstructionSummary;
  sourceTotals: RedeSourceTotals;
}> {
  const workbook = XLSX.read(await file.arrayBuffer(), {
    type: "array",
    cellDates: true,
  });
  const readingRules = options.readingRules ?? [];
  const lines: ParsedAcquirerLine[] = [];
  const processedSheets: string[] = [];
  const matchesByRule: Record<string, number> = {};
  const exclusionsByRule: Record<string, number> = {};
  let excludedRows = 0;
  let sourceRows = 0;
  let sourceSales = 0;
  let sourceGross = 0;
  let sourceFees = 0;
  let sourceCalculatedNet = 0;

  const push = (line: Omit<ParsedAcquirerLine, "id">) => {
    lines.push({ id: lines.length + 1, ...line });
  };

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
      raw: true,
      range: 0,
    });
    const headerIndex = findHeaderIndex(matrix);
    if (headerIndex < 0 || !isPagarmeMovementSheet(sheetName, matrix)) continue;
    processedSheets.push(sheetName);

    matrix.slice(headerIndex + 1).forEach((values, offset) => {
      if (!values.some((value) => value !== null && value !== "")) return;
      const row = semanticRow(values);
      const operationType = normalize(row["tipo da operação"]);
      const operationDescription = text(row["descrição da operação"]);
      const normalizedDescription = normalize(operationDescription);
      const operationDate = date(row["data da operação"]) || manualPaymentDate;
      const sourceRow = headerIndex + offset + 2;
      const entryGross = Math.abs(number(row["entrada bruta"]));
      const exitGross = Math.abs(number(row["saída bruta"]));
      const entryNet = Math.abs(number(row["entrada líquida"]));
      const exitNet = Math.abs(number(row["saída líquida"]));
      const operationFee = Math.abs(number(row["taxa de operação"]));
      const anticipationFee = Math.abs(number(row["taxa de antecipação"]));
      const declaredTotalFee = Math.abs(number(row["taxa total da operação"]));
      const totalFee = declaredTotalFee || roundMoney(operationFee + anticipationFee);

      if (
        !operationDate
        || (!operationType && !operationDescription)
        || Math.max(entryGross, exitGross, entryNet, exitNet, totalFee) <= 0.009
      ) return;

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
      }

      const common = {
        sourceSheet: sheetName,
        sourceRow,
        saleDate: operationDate,
        dueDate: operationDate,
        paymentDate: operationDate,
        acquirer: "PAGARME",
      } as const;
      const operationId = text(row["id da operação"]);

      if (operationType.includes("liquida")) {
        const gross = entryGross || entryNet;
        const net = entryNet || roundMoney(gross - totalFee);
        const method = text(row["método de pagamento"]);
        const anticipated = normalize(method).includes("antecip");
        const brand = displayBrand(operationDescription);
        const modality = transactionType(method);
        const installmentCount = installments(row.parcela);
        const otherFee = Math.max(roundMoney(totalFee - anticipationFee), 0);

        sourceSales += 1;
        sourceGross = roundMoney(sourceGross + gross);
        sourceFees = roundMoney(sourceFees + totalFee);
        sourceCalculatedNet = roundMoney(sourceCalculatedNet + net);
        if (evaluation.excluded) return;

        push({
          ...common,
          eventType: "SALE",
          description: [
            "LIQUIDAÇÃO PAGAR.ME",
            brand,
            method,
            operationId ? `operação ${operationId}` : "",
          ].filter(Boolean).join(" - "),
          category: categories.sale,
          amount: roundMoney(gross),
          anticipated,
          status: "OK",
          rateValidation: "NOT_APPLICABLE",
          transactionType: modality,
          cardBrand: brand || undefined,
          installments: installmentCount,
          sourceMetadata: metadata(row, { netLiquidation: true }),
        });

        if (otherFee > 0.009) {
          push({
            ...common,
            eventType: "FEE",
            description: `TAXA DE OPERAÇÃO PAGAR.ME${operationId ? ` - operação ${operationId}` : ""}`,
            category: categories.fee,
            amount: -otherFee,
            anticipated: false,
            status: "OK",
            rateValidation: "NOT_APPLICABLE",
            transactionType: modality,
            cardBrand: brand || undefined,
            installments: installmentCount,
            feeCategory: "SALE_FEE",
            sourceMetadata: metadata(row),
          });
        }

        if (anticipationFee > 0.009) {
          push({
            ...common,
            eventType: "ANTICIPATION",
            description: `TAXA DE ANTECIPAÇÃO PAGAR.ME${operationId ? ` - operação ${operationId}` : ""}`,
            category: categoryForFee("ANTICIPATION", categories),
            amount: -roundMoney(anticipationFee),
            anticipated: true,
            status: "OK",
            rateValidation: "NOT_APPLICABLE",
            transactionType: modality,
            cardBrand: brand || undefined,
            installments: installmentCount,
            feeCategory: "ANTICIPATION",
            sourceMetadata: metadata(row),
          });
        }

        const parsedNet = roundMoney(gross - totalFee);
        const reconciliationAdjustment = roundMoney(net - parsedNet);
        if (Math.abs(reconciliationAdjustment) > 0.009) {
          push({
            ...common,
            eventType: "ADJUSTMENT",
            description: `AJUSTE DE CONCILIAÇÃO PAGAR.ME${operationId ? ` - operação ${operationId}` : ""}`,
            category: categories.adjustment,
            amount: reconciliationAdjustment,
            anticipated: false,
            status: "REVIEW",
            rateValidation: "NOT_APPLICABLE",
            transactionType: modality,
            cardBrand: brand || undefined,
            installments: installmentCount,
            feeCategory: "ADJUSTMENT",
            sourceMetadata: metadata(row),
          });
        }
        return;
      }

      if (operationType.includes("transfer")) {
        const transferFee = totalFee || operationFee;
        sourceFees = roundMoney(sourceFees + transferFee);
        sourceCalculatedNet = roundMoney(sourceCalculatedNet - transferFee);
        if (evaluation.excluded || transferFee <= 0.009) return;

        push({
          ...common,
          eventType: "FEE",
          description: `TARIFA DE TRANSFERÊNCIA PAGAR.ME${operationId ? ` - operação ${operationId}` : ""}`,
          category: categories.fee,
          amount: -roundMoney(transferFee),
          anticipated: false,
          status: "OK",
          rateValidation: "NOT_APPLICABLE",
          transactionType: "OTHER",
          feeCategory: "OTHER",
          sourceMetadata: metadata(row, {
            reconciliationOnly: true,
            transferPrincipal: exitGross || Math.max(exitNet - transferFee, 0),
          }),
        });
        return;
      }

      if (normalizedDescription.includes("servi") && normalizedDescription.includes("gateway")) {
        const amount = exitNet || exitGross;
        sourceFees = roundMoney(sourceFees + amount);
        sourceCalculatedNet = roundMoney(sourceCalculatedNet - amount);
        if (evaluation.excluded || amount <= 0.009) return;

        push({
          ...common,
          eventType: "FEE",
          description: `SERVIÇOS DE GATEWAY PAGAR.ME - ${operationDescription}`,
          category: categories.fee,
          amount: -roundMoney(amount),
          anticipated: false,
          status: "OK",
          rateValidation: "NOT_APPLICABLE",
          transactionType: "OTHER",
          feeCategory: "OTHER",
          sourceMetadata: metadata(row),
        });
        return;
      }

      const signedAmount = entryNet || entryGross
        || -(exitNet || exitGross);
      sourceCalculatedNet = roundMoney(sourceCalculatedNet + signedAmount);
      if (evaluation.excluded || Math.abs(signedAmount) <= 0.009) return;
      const isYield = normalizedDescription.includes("rendimento");

      push({
        ...common,
        eventType: "ADJUSTMENT",
        description: `${isYield ? "RENDIMENTO" : "OPERAÇÃO DE SALDO"} PAGAR.ME - ${operationDescription}`,
        category: categories.adjustment,
        amount: roundMoney(signedAmount),
        anticipated: false,
        status: isYield ? "OK" : "REVIEW",
        rateValidation: "NOT_APPLICABLE",
        transactionType: "OTHER",
        feeCategory: "ADJUSTMENT",
        sourceMetadata: metadata(row),
      });
    });
  }

  if (processedSheets.length === 0) {
    throw new Error(
      "O arquivo não possui o cabeçalho esperado do extrato de movimentações da Pagar.me.",
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
      fees: sourceFees ? roundMoney(sourceFees) : null,
      net: sourceRows ? roundMoney(sourceCalculatedNet) : null,
    },
  };
}
