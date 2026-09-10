import * as XLSX from "xlsx";
import { selectContractedRate } from "./contracted-rate-matcher";
import {
  evaluateReadingInstructions,
  type AcquirerReadingRule,
} from "./reading-instructions";
import type {
  Categories,
  ContractedRate,
  ParsedAcquirerLine,
  ReadingInstructionSummary,
  RedeSourceTotals,
} from "./rede-workbook-parser";

type ParseAleloOptions = {
  readingRules?: AcquirerReadingRule[];
};

type SemanticRow = Record<string, unknown>;

const normalize = (value: unknown) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/\u00a0/g, " ")
  .trim()
  .toLowerCase();

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
  const raw = text(value);
  const br = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (br) return `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : "";
};

function sheetByNormalizedName(workbook: XLSX.WorkBook, expected: string) {
  const sheetName = workbook.SheetNames.find(
    (candidate) => normalize(candidate) === normalize(expected),
  );
  return sheetName ? { sheetName, sheet: workbook.Sheets[sheetName] } : null;
}

function looksLikeReceipt(values: unknown[]) {
  return values.length >= 15
    && Boolean(date(values[4]))
    && Boolean(text(values[6]))
    && Boolean(text(values[8]))
    && Number.isFinite(number(values[11]))
    && number(values[11]) > 0
    && Boolean(date(values[14]));
}

function looksLikeOtherTransaction(values: unknown[]) {
  return values.length >= 9
    && Boolean(text(values[5]))
    && Math.abs(number(values[6])) > 0.009
    && Boolean(date(values[7]) || date(values[8]));
}

export function isAleloWorkbook(workbook: XLSX.WorkBook) {
  const receipts = sheetByNormalizedName(workbook, "Recebimentos");
  const others = sheetByNormalizedName(workbook, "Outras Transações");
  if (!receipts || !others) return false;

  const instructions = sheetByNormalizedName(workbook, "Instruções");
  if (instructions) {
    const content = XLSX.utils.sheet_to_json<unknown[]>(instructions.sheet, {
      header: 1,
      raw: true,
      defval: null,
    }).flat().map(normalize).join(" ");
    if (content.includes("alelo instituicao de pagamentos")) return true;
  }

  const receiptRows = XLSX.utils.sheet_to_json<unknown[]>(receipts.sheet, {
    header: 1,
    raw: true,
    defval: null,
  });
  const otherRows = XLSX.utils.sheet_to_json<unknown[]>(others.sheet, {
    header: 1,
    raw: true,
    defval: null,
  });
  return receiptRows.some(looksLikeReceipt)
    && otherRows.some(looksLikeOtherTransaction);
}

function receiptRow(values: unknown[]): SemanticRow {
  return {
    cnpj: values[0],
    ec: values[1],
    "razao social": values[2],
    estabelecimento: values[3],
    "data da venda": values[4],
    hora: values[5],
    "id da transacao": values[6],
    "numero da autorizacao": values[7],
    produto: values[8],
    "numero do cartao": values[9],
    "meio de captura": values[10],
    "valor bruto": values[11],
    "valor liquido": values[12],
    status: values[13],
    "data de pagamento": values[14],
    modalidade: "Voucher",
    bandeira: "Alelo",
    descricao: values[8],
  };
}

function otherTransactionRow(values: unknown[]): SemanticRow {
  return {
    cnpj: values[0],
    ec: values[1],
    "razao social": values[2],
    estabelecimento: values[3],
    produto: values[4],
    descricao: values[5],
    valor: values[6],
    "data do lancamento": values[7],
    "data de pagamento": values[8],
    modalidade: "Voucher",
    bandeira: "Alelo",
  };
}

function sourceMetadata(row: SemanticRow) {
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

function rateValidation(chargedRate: number, rates: ContractedRate[]) {
  if (chargedRate <= 0) {
    return { rateValidation: "NOT_APPLICABLE" as const };
  }
  const contracted = selectContractedRate(rates, "VOUCHER", 1, "Alelo");
  if (!contracted) return { rateValidation: "NOT_CONFIGURED" as const };
  const contractedRate = Math.round(Number(contracted.rate) * 10000) / 10000;
  const tolerance = Number(contracted.tolerance || 0);
  return {
    rateValidation:
      Math.abs(chargedRate - contractedRate) <= tolerance + 0.000001
        ? "MATCH" as const
        : "DIVERGENT" as const,
    contractedRate,
  };
}

function instructionSummary(
  readingRules: AcquirerReadingRule[],
  excludedRows: number,
  matchesByRule: Record<string, number>,
  exclusionsByRule: Record<string, number>,
): ReadingInstructionSummary {
  return {
    rules: readingRules,
    excludedRows,
    matchesByRule,
    exclusionsByRule,
    unmatchedRuleIds: readingRules
      .filter((rule) => (matchesByRule[rule.id] ?? 0) === 0)
      .map((rule) => rule.id),
  };
}

export async function parseAleloWorkbook(
  file: File,
  categories: Categories,
  manualPaymentDate: string,
  contractedRates: ContractedRate[],
  options: ParseAleloOptions = {},
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
  if (!isAleloWorkbook(workbook)) {
    throw new Error(
      "O arquivo não corresponde ao relatório de recebimentos da Alelo com as abas Recebimentos e Outras Transações.",
    );
  }

  const readingRules = options.readingRules ?? [];
  const lines: ParsedAcquirerLine[] = [];
  const processedSheets: string[] = [];
  const matchesByRule = Object.fromEntries(readingRules.map((rule) => [rule.id, 0]));
  const exclusionsByRule = Object.fromEntries(readingRules.map((rule) => [rule.id, 0]));
  const seenReceipts = new Set<string>();
  let excludedRows = 0;
  let sourceRows = 0;
  let sourceSales = 0;
  let sourceGross = 0;
  let sourceFees = 0;
  let sourceNet = 0;
  let nextId = 1;

  const push = (line: Omit<ParsedAcquirerLine, "id">) => {
    lines.push({ id: nextId++, ...line });
  };

  const evaluate = (row: SemanticRow, sheetName: string) => {
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
    return evaluation;
  };

  const receipts = sheetByNormalizedName(workbook, "Recebimentos");
  if (receipts) {
    processedSheets.push(receipts.sheetName);
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(receipts.sheet, {
      header: 1,
      raw: true,
      defval: null,
    });
    const firstSourceRow = receipts.sheet["!ref"]
      ? XLSX.utils.decode_range(receipts.sheet["!ref"]).s.r + 1
      : 1;

    matrix.forEach((values, rowIndex) => {
      if (!looksLikeReceipt(values)) return;
      const row = receiptRow(values);
      const gross = Math.abs(number(row["valor bruto"]));
      const net = Math.abs(number(row["valor liquido"]));
      const saleDate = date(row["data da venda"]);
      const paymentDate = date(row["data de pagamento"]) || manualPaymentDate;
      const transactionId = text(row["id da transacao"]);
      const authorization = text(row["numero da autorizacao"]);
      const status = normalize(row.status);
      if (/negad|recus|reprov|falh|cancel/.test(status)) return;

      const deduplicationKey = [transactionId, authorization, saleDate, gross].join("|");
      if (seenReceipts.has(deduplicationKey)) return;
      seenReceipts.add(deduplicationKey);

      sourceRows += 1;
      sourceSales += 1;
      sourceGross = roundMoney(sourceGross + gross);
      const fee = Math.max(roundMoney(gross - net), 0);
      sourceFees = roundMoney(sourceFees + fee);
      sourceNet = roundMoney(sourceNet + net);

      const evaluation = evaluate(row, receipts.sheetName);
      if (evaluation.excluded) return;

      const product = text(row.produto) || "Benefício";
      const establishment = text(row.estabelecimento) || text(row.ec);
      const detail = [
        product,
        establishment ? `EC ${establishment}` : "",
        transactionId ? `transação ${transactionId}` : "",
        authorization ? `aut. ${authorization}` : "",
      ].filter(Boolean).join(" - ");
      const chargedRate = gross > 0 ? (fee / gross) * 100 : 0;
      const validation = rateValidation(chargedRate, contractedRates);
      const metadata = {
        ...sourceMetadata(row),
        "nsu/cv": transactionId || null,
      };
      const common = {
        sourceSheet: receipts.sheetName,
        sourceRow: firstSourceRow + rowIndex,
        saleDate: saleDate || paymentDate,
        dueDate: paymentDate,
        paymentDate,
        acquirer: "ALELO",
        transactionType: "VOUCHER" as const,
        cardBrand: "Alelo",
        installments: 1,
      };

      push({
        ...common,
        eventType: "SALE",
        description: `VENDA ALELO ${detail}`,
        category: categories.sale,
        amount: roundMoney(gross),
        anticipated: false,
        status: validation.rateValidation === "DIVERGENT" ? "REVIEW" : "OK",
        rateValidation: validation.rateValidation,
        chargedRate: chargedRate || undefined,
        contractedRate: "contractedRate" in validation
          ? validation.contractedRate
          : undefined,
        sourceMetadata: metadata,
      });

      if (fee > 0.009) {
        push({
          ...common,
          eventType: "FEE",
          description: `TAXA MDR ALELO ${detail}`,
          category: categories.fee,
          amount: -fee,
          anticipated: false,
          status: "OK",
          rateValidation: "NOT_APPLICABLE",
          chargedRate: chargedRate || undefined,
          feeCategory: "SALE_FEE",
          sourceMetadata: metadata,
        });
      }
    });
  }

  const others = sheetByNormalizedName(workbook, "Outras Transações");
  if (others) {
    processedSheets.push(others.sheetName);
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(others.sheet, {
      header: 1,
      raw: true,
      defval: null,
    });
    const firstSourceRow = others.sheet["!ref"]
      ? XLSX.utils.decode_range(others.sheet["!ref"]).s.r + 1
      : 1;

    matrix.forEach((values, rowIndex) => {
      if (!looksLikeOtherTransaction(values)) return;
      const row = otherTransactionRow(values);
      const amount = roundMoney(number(row.valor));
      const description = text(row.descricao);
      const normalizedDescription = normalize(description);
      const paymentDate = date(row["data de pagamento"])
        || date(row["data do lancamento"])
        || manualPaymentDate;
      const saleDate = date(row["data do lancamento"]) || paymentDate;

      sourceRows += 1;
      sourceNet = roundMoney(sourceNet + amount);
      const isFee = /tarifa|taxa/.test(normalizedDescription) && amount < 0;
      if (isFee) sourceFees = roundMoney(sourceFees + Math.abs(amount));

      const evaluation = evaluate(row, others.sheetName);
      if (evaluation.excluded) return;

      const isCancellation = /cancel|chargeback|contest/.test(normalizedDescription);
      const eventType: ParsedAcquirerLine["eventType"] = isCancellation
        ? "CANCELLATION"
        : isFee ? "FEE" : "ADJUSTMENT";
      const product = text(row.produto);
      const establishment = text(row.estabelecimento) || text(row.ec);

      push({
        sourceSheet: others.sheetName,
        sourceRow: firstSourceRow + rowIndex,
        eventType,
        saleDate,
        dueDate: paymentDate,
        paymentDate,
        description: `${description.toUpperCase()} ALELO${product ? ` - ${product}` : ""}${establishment ? ` - EC ${establishment}` : ""}`,
        category: eventType === "FEE"
          ? categories.fee
          : eventType === "CANCELLATION"
            ? categories.cancellation
            : categories.adjustment,
        amount: eventType === "CANCELLATION" ? -Math.abs(amount) : amount,
        anticipated: false,
        status: "OK",
        rateValidation: "NOT_APPLICABLE",
        acquirer: "ALELO",
        transactionType: "VOUCHER",
        cardBrand: "Alelo",
        installments: 1,
        feeCategory: eventType === "FEE"
          ? "OTHER"
          : eventType === "CANCELLATION" ? "CANCELLATION" : "ADJUSTMENT",
        sourceMetadata: sourceMetadata(row),
      });
    });
  }

  return {
    lines,
    processedSheets,
    sourceRows,
    instructionSummary: instructionSummary(
      readingRules,
      excludedRows,
      matchesByRule,
      exclusionsByRule,
    ),
    sourceTotals: {
      rows: sourceSales || null,
      gross: sourceSales ? roundMoney(sourceGross) : null,
      fees: sourceSales || sourceFees ? roundMoney(sourceFees) : null,
      net: sourceRows ? roundMoney(sourceNet) : null,
    },
  };
}
