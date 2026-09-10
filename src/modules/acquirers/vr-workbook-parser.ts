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

type ParseVrOptions = {
  readingRules?: AcquirerReadingRule[];
};

type Row = Record<string, unknown>;

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

function headersAt(values: unknown[]) {
  return new Set(values.map(normalize));
}

function findHeaderIndex(matrix: unknown[][]) {
  return matrix.findIndex((values) => {
    const headers = headersAt(values);
    return [
      "numero guia",
      "produto",
      "contrato",
      "status",
      "corte *",
      "pagamento *",
      "valor bruto",
      "valor liquido",
    ].every((header) => headers.has(header));
  });
}

export function isVrBenefitsWorkbook(
  sheetName: string,
  matrix: unknown[][],
) {
  return normalize(sheetName).includes("guia")
    && normalize(sheetName).includes("reembolso")
    && findHeaderIndex(matrix) >= 0;
}

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

function findMerchantData(matrix: unknown[][]) {
  const headerIndex = matrix.findIndex((values) => {
    const headers = headersAt(values);
    return headers.has("cnpj") && headers.has("razao social");
  });
  if (headerIndex < 0) return { cnpj: "", businessName: "" };
  const headers = matrix[headerIndex];
  const values = matrix[headerIndex + 1] ?? [];
  const row = record(headers, values);
  return {
    cnpj: text(get(row, "cnpj")),
    businessName: text(get(row, "razao social")),
  };
}

function rateValidation(chargedRate: number, rates: ContractedRate[]) {
  if (chargedRate <= 0) {
    return { rateValidation: "NOT_APPLICABLE" as const };
  }
  const contracted = selectContractedRate(
    rates,
    "VOUCHER",
    1,
    "VR Benefícios",
  );
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

export async function parseVrBenefitsWorkbook(
  file: File,
  categories: Categories,
  manualPaymentDate: string,
  contractedRates: ContractedRate[],
  options: ParseVrOptions = {},
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
  const matchesByRule = Object.fromEntries(readingRules.map((rule) => [rule.id, 0]));
  const exclusionsByRule = Object.fromEntries(readingRules.map((rule) => [rule.id, 0]));
  const seenGuides = new Set<string>();
  let excludedRows = 0;
  let sourceRows = 0;
  let sourceGross = 0;
  let sourceFees = 0;
  let sourceNet = 0;
  let declaredGross: number | null = null;
  let declaredNet: number | null = null;
  let nextId = 1;

  const push = (line: Omit<ParsedAcquirerLine, "id">) => {
    lines.push({ id: nextId++, ...line });
  };

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: true,
    });
    if (!isVrBenefitsWorkbook(sheetName, matrix)) continue;

    const headerIndex = findHeaderIndex(matrix);
    const headers = matrix[headerIndex];
    const merchant = findMerchantData(matrix);
    processedSheets.push(sheetName);

    matrix.slice(headerIndex + 1).forEach((values, offset) => {
      if (normalize(values[5]) === "valor total") {
        declaredGross = number(values[6]);
        declaredNet = number(values[7]);
        return;
      }

      const row = record(headers, values);
      const guideNumber = text(get(row, "numero guia"));
      const gross = Math.abs(number(get(row, "valor bruto")));
      const net = Math.abs(number(get(row, "valor liquido")));
      const paymentDate = date(get(row, "pagamento *", "pagamento"))
        || manualPaymentDate;
      if (!guideNumber || gross <= 0.009 || !paymentDate) return;
      if (seenGuides.has(guideNumber)) return;
      seenGuides.add(guideNumber);

      const status = normalize(get(row, "status"));
      if (/cancel|negad|recus|reprov|falh/.test(status)) return;
      const product = text(get(row, "produto")) || "Benefício";
      const contract = text(get(row, "contrato"));
      const saleDate = date(get(row, "corte *", "corte")) || paymentDate;
      const fee = Math.max(roundMoney(gross - net), 0);
      const chargedRate = gross > 0 ? (fee / gross) * 100 : 0;
      const validation = rateValidation(chargedRate, contractedRates);
      const semanticRow: Row = {
        ...row,
        cnpj: merchant.cnpj,
        estabelecimento: merchant.businessName,
        bandeira: "VR Benefícios",
        modalidade: "Voucher",
        descricao: product,
      };

      sourceRows += 1;
      sourceGross = roundMoney(sourceGross + gross);
      sourceFees = roundMoney(sourceFees + fee);
      sourceNet = roundMoney(sourceNet + net);

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

      const details = [
        product,
        `guia ${guideNumber}`,
        contract ? `contrato ${contract}` : "",
      ].filter(Boolean).join(" - ");
      const sourceRow = headerIndex + offset + 2;
      const rowMetadata = {
        ...metadata(semanticRow),
        guideNumber,
      };
      const common = {
        sourceSheet: sheetName,
        sourceRow,
        saleDate,
        dueDate: paymentDate,
        paymentDate,
        acquirer: "VR BENEFÍCIOS",
        transactionType: "VOUCHER" as const,
        cardBrand: "VR Benefícios",
        installments: 1,
      };

      push({
        ...common,
        eventType: "SALE",
        description: `REEMBOLSO VR BENEFÍCIOS - ${details}`,
        category: categories.sale,
        amount: roundMoney(gross),
        anticipated: false,
        status:
          validation.rateValidation === "DIVERGENT" || !status.includes("pago")
            ? "REVIEW"
            : "OK",
        rateValidation: validation.rateValidation,
        chargedRate: chargedRate || undefined,
        contractedRate: "contractedRate" in validation
          ? validation.contractedRate
          : undefined,
        sourceMetadata: rowMetadata,
      });

      if (fee > 0.009) {
        push({
          ...common,
          eventType: "FEE",
          description: `TAXA VR BENEFÍCIOS - ${details}`,
          category: categories.fee,
          amount: -fee,
          anticipated: false,
          status: "OK",
          rateValidation: "NOT_APPLICABLE",
          chargedRate: chargedRate || undefined,
          feeCategory: "SALE_FEE",
          sourceMetadata: rowMetadata,
        });
      }
    });
  }

  if (processedSheets.length === 0) {
    throw new Error(
      "O arquivo não possui a aba Guias de Reembolso com o cabeçalho esperado da VR Benefícios.",
    );
  }

  const totalsGross = declaredGross ?? sourceGross;
  const totalsNet = declaredNet ?? sourceNet;
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
      gross: sourceRows ? roundMoney(totalsGross) : null,
      fees: sourceRows ? roundMoney(totalsGross - totalsNet) : null,
      net: sourceRows ? roundMoney(totalsNet) : null,
    },
  };
}
