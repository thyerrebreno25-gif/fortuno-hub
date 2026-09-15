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

type ParsePluxeeOptions = {
  readingRules?: AcquirerReadingRule[];
};

type Row = Record<string, unknown>;

type PluxeeSale = {
  row: Row;
  sourceSheet: string;
  sourceRow: number;
  saleDate: string;
  paymentDate: string;
  gross: number;
  origin: string;
  feeGroup: "PAT" | "AUXILIO" | "OUTROS";
  excluded: boolean;
};

const normalize = (value: unknown) => String(value ?? "")
  .replace(/n[º°]/gi, "numero")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/\u00a0/g, " ")
  .replace(/\uFFFD/g, "")
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
    return [
      "data da transacao",
      "data do pagamento",
      "status",
      "descricao",
      "numero de autorizacao",
      "valor bruto r$",
      "origem",
    ].every((header) => headers.has(header));
  });
}

export function isPluxeePaymentsSheet(
  sheetName: string,
  matrix: unknown[][],
) {
  if (findHeaderIndex(matrix) < 0) return false;
  const content = matrix.slice(0, 22).flat().map(normalize).join(" ");
  return normalize(sheetName).replace(/[^a-z0-9]+/g, " ").includes("extrato pagamentos")
    && content.includes("pluxee");
}

function sourceMetadata(row: Row) {
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

function summaryAmount(
  matrix: unknown[][],
  pattern: RegExp,
): number | null {
  for (const values of matrix) {
    if (!pattern.test(values.map(normalize).join(" "))) continue;
    for (let index = values.length - 1; index >= 0; index -= 1) {
      const value = values[index];
      if (typeof value === "number" && Number.isFinite(value)) {
        return Math.abs(roundMoney(value));
      }
      if (typeof value === "string" && /(?:R\$\s*)?-?\d+[.,]\d{2}/.test(value)) {
        return Math.abs(roundMoney(number(value)));
      }
    }
  }
  return null;
}

function feeGroup(origin: string): PluxeeSale["feeGroup"] {
  const normalized = normalize(origin);
  if (normalized.includes("auxilio")) return "AUXILIO";
  if (normalized.includes("pat")) return "PAT";
  return "OUTROS";
}

function allocateCents(sales: PluxeeSale[], total: number) {
  const result = new Map<number, number>();
  const totalCents = Math.max(0, Math.round(total * 100));
  const gross = sales.reduce((sum, sale) => sum + sale.gross, 0);
  if (totalCents === 0 || gross <= 0 || sales.length === 0) return result;

  const allocations = sales.map((sale) => {
    const exact = (totalCents * sale.gross) / gross;
    return {
      sourceRow: sale.sourceRow,
      cents: Math.floor(exact),
      remainder: exact - Math.floor(exact),
    };
  });
  let remaining = totalCents - allocations.reduce((sum, item) => sum + item.cents, 0);
  allocations
    .sort((left, right) => right.remainder - left.remainder || left.sourceRow - right.sourceRow)
    .forEach((item) => {
      if (remaining <= 0) return;
      item.cents += 1;
      remaining -= 1;
    });
  allocations.forEach((item) => result.set(item.sourceRow, item.cents / 100));
  return result;
}

function rateValidation(
  chargedRate: number,
  rates: ContractedRate[],
) {
  if (chargedRate <= 0) {
    return { rateValidation: "NOT_APPLICABLE" as const };
  }
  const contracted = selectContractedRate(rates, "VOUCHER", 1, "Pluxee");
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

export async function parsePluxeeWorkbook(
  file: File,
  categories: Categories,
  manualPaymentDate: string,
  contractedRates: ContractedRate[],
  options: ParsePluxeeOptions = {},
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
  const processedSheets: string[] = [];
  const sales: PluxeeSale[] = [];
  const matchesByRule = Object.fromEntries(readingRules.map((rule) => [rule.id, 0]));
  const exclusionsByRule = Object.fromEntries(readingRules.map((rule) => [rule.id, 0]));
  const seen = new Set<string>();
  let excludedRows = 0;
  let declaredGross: number | null = null;
  let declaredTaxes: number | null = null;
  let declaredPatTaxes: number | null = null;
  let declaredAidTaxes: number | null = null;
  let declaredServices = 0;
  let declaredOtherDeductions = 0;
  let declaredNet: number | null = null;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: true,
    });
    if (!isPluxeePaymentsSheet(sheetName, matrix)) continue;

    const headerIndex = findHeaderIndex(matrix);
    const headers = matrix[headerIndex];
    const firstSourceRow = sheet["!ref"]
      ? XLSX.utils.decode_range(sheet["!ref"]).s.r + 1
      : 1;
    processedSheets.push(sheetName);

    declaredGross = summaryAmount(matrix.slice(0, headerIndex), /total bruto periodo/);
    declaredTaxes = summaryAmount(matrix.slice(0, headerIndex), /total taxas/);
    declaredPatTaxes = summaryAmount(
      matrix.slice(0, headerIndex),
      /taxa de administracao - pat/,
    );
    declaredAidTaxes = summaryAmount(
      matrix.slice(0, headerIndex),
      /taxa de administracao - auxilio/,
    );
    declaredServices = summaryAmount(
      matrix.slice(0, headerIndex),
      /total srv\. contratado/,
    ) ?? 0;
    declaredOtherDeductions = summaryAmount(
      matrix.slice(0, headerIndex),
      /total outras deducoes/,
    ) ?? 0;
    declaredNet = summaryAmount(matrix.slice(0, headerIndex), /total liquido/);

    matrix.slice(headerIndex + 1).forEach((values, offset) => {
      const row = record(headers, values);
      const saleDate = date(get(row, "data da transacao"));
      const gross = Math.abs(number(get(row, "valor bruto r$", "valor bruto")));
      if (!saleDate || gross <= 0.009) return;

      const status = normalize(get(row, "status"));
      if (/cancel|negad|recus|reprov|falh/.test(status)) return;
      const authorization = text(get(row, "numero de autorizacao"));
      const card = text(get(row, "numero do cartao"));
      const key = [authorization, card, saleDate, gross].join("|");
      if (seen.has(key)) return;
      seen.add(key);

      const sourceRow = firstSourceRow + headerIndex + offset + 1;
      const origin = text(get(row, "origem"));
      const semanticRow: Row = {
        ...row,
        bandeira: "Pluxee",
        modalidade: "Voucher",
        estabelecimento: get(row, "razao social"),
      };
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
      }

      sales.push({
        row: semanticRow,
        sourceSheet: sheetName,
        sourceRow,
        saleDate,
        paymentDate: date(get(row, "data do pagamento")) || manualPaymentDate,
        gross: roundMoney(gross),
        origin,
        feeGroup: feeGroup(origin),
        excluded: evaluation.excluded,
      });
    });
  }

  if (processedSheets.length === 0) {
    throw new Error(
      "O arquivo não corresponde ao extrato de pagamentos detalhado da Pluxee.",
    );
  }

  const sourceGross = roundMoney(sales.reduce((sum, sale) => sum + sale.gross, 0));
  const taxTotal = declaredTaxes ?? Math.max(
    roundMoney((declaredPatTaxes ?? 0) + (declaredAidTaxes ?? 0)),
    0,
  );
  const totalDeductions = declaredGross != null && declaredNet != null
    ? roundMoney(declaredGross - declaredNet)
    : roundMoney(taxTotal + declaredServices + declaredOtherDeductions);
  const sourceControlValid = (declaredGross == null || Math.abs(sourceGross - declaredGross) <= 0.01)
    && (declaredNet == null || Math.abs(sourceGross - totalDeductions - declaredNet) <= 0.01);

  const knownGroupFees = new Map<PluxeeSale["feeGroup"], number>();
  if (declaredPatTaxes != null) knownGroupFees.set("PAT", declaredPatTaxes);
  if (declaredAidTaxes != null) knownGroupFees.set("AUXILIO", declaredAidTaxes);
  if (knownGroupFees.size === 0 && taxTotal > 0) {
    knownGroupFees.set("OUTROS", taxTotal);
  }

  const allocations = new Map<number, number>();
  for (const [group, fee] of knownGroupFees) {
    const groupSales = group === "OUTROS" && knownGroupFees.size === 1
      ? sales
      : sales.filter((sale) => sale.feeGroup === group);
    allocateCents(groupSales, fee).forEach((amount, row) => allocations.set(row, amount));
  }

  const allocatedTaxes = roundMoney(
    Array.from(allocations.values()).reduce((sum, amount) => sum + amount, 0),
  );
  const unallocatedTaxes = Math.max(roundMoney(taxTotal - allocatedTaxes), 0);
  const lines: ParsedAcquirerLine[] = [];
  let nextId = 1;
  const push = (line: Omit<ParsedAcquirerLine, "id">) => {
    lines.push({ id: nextId++, ...line });
  };

  sales.forEach((sale) => {
    if (sale.excluded) return;
    const fee = allocations.get(sale.sourceRow) ?? 0;
    const groupSales = sales.filter((item) => item.feeGroup === sale.feeGroup);
    const groupGross = groupSales.reduce((sum, item) => sum + item.gross, 0);
    const groupFee = knownGroupFees.get(sale.feeGroup) ?? 0;
    const chargedRate = groupGross > 0 ? (groupFee / groupGross) * 100 : 0;
    const validation = rateValidation(chargedRate, contractedRates);
    const authorization = text(get(sale.row, "numero de autorizacao"));
    const card = text(get(sale.row, "numero do cartao"));
    const details = [
      sale.origin || "BENEFÍCIO",
      authorization ? `aut. ${authorization}` : "",
      card ? `cartão ${card}` : "",
    ].filter(Boolean).join(" - ");
    const metadata = {
      ...sourceMetadata(sale.row),
      taxa_administracao_rateada: fee > 0,
      grupo_taxa: sale.feeGroup,
    };
    const common = {
      sourceSheet: sale.sourceSheet,
      sourceRow: sale.sourceRow,
      saleDate: sale.saleDate,
      dueDate: sale.paymentDate,
      paymentDate: sale.paymentDate,
      acquirer: "PLUXEE",
      transactionType: "VOUCHER" as const,
      cardBrand: "Pluxee",
      installments: 1,
    };

    push({
      ...common,
      eventType: "SALE",
      description: `VENDA PLUXEE - ${details}`,
      category: categories.sale,
      amount: sale.gross,
      anticipated: false,
      status: !sourceControlValid || validation.rateValidation === "DIVERGENT"
        ? "REVIEW"
        : "OK",
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
        description: `TAXA DE ADMINISTRAÇÃO PLUXEE - ${details}`,
        category: categories.fee,
        amount: -roundMoney(fee),
        anticipated: false,
        status: sourceControlValid ? "OK" : "REVIEW",
        rateValidation: "NOT_APPLICABLE",
        chargedRate: chargedRate || undefined,
        feeCategory: "SALE_FEE",
        sourceMetadata: metadata,
      });
    }
  });

  const latestPaymentDate = sales
    .map((sale) => sale.paymentDate)
    .filter(Boolean)
    .sort()
    .at(-1) || manualPaymentDate;
  const pushSummaryDeduction = (
    amount: number,
    description: string,
    sourceRow: number,
  ) => {
    if (amount <= 0.009) return;
    push({
      sourceSheet: processedSheets[0],
      sourceRow,
      eventType: "FEE",
      saleDate: latestPaymentDate,
      dueDate: latestPaymentDate,
      paymentDate: latestPaymentDate,
      description,
      category: categories.fee,
      amount: -roundMoney(amount),
      anticipated: false,
      status: sourceControlValid ? "OK" : "REVIEW",
      rateValidation: "NOT_APPLICABLE",
      acquirer: "PLUXEE",
      transactionType: "VOUCHER",
      cardBrand: "Pluxee",
      installments: 1,
      feeCategory: "OTHER",
      sourceMetadata: { valor_consolidado_no_resumo: true },
    });
  };
  pushSummaryDeduction(unallocatedTaxes, "OUTRAS TAXAS PLUXEE", 10);
  pushSummaryDeduction(declaredServices, "SERVIÇOS CONTRATADOS PLUXEE", 13);
  pushSummaryDeduction(declaredOtherDeductions, "OUTRAS DEDUÇÕES PLUXEE", 15);

  return {
    lines,
    processedSheets,
    sourceRows: sales.length,
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
      rows: sales.length || null,
      gross: sales.length ? roundMoney(declaredGross ?? sourceGross) : null,
      fees: sales.length ? totalDeductions : null,
      net: sales.length
        ? roundMoney(declaredNet ?? sourceGross - totalDeductions)
        : null,
    },
  };
}
