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

type ParseTicketOptions = {
  readingRules?: AcquirerReadingRule[];
};

type Row = Record<string, unknown>;

type TicketSale = {
  row: Row;
  sourceRow: number;
  saleDate: string;
  amount: number;
  excluded: boolean;
};

type TicketFee = {
  row: Row;
  sourceRow: number;
  description: string;
  amount: number;
  excluded: boolean;
};

type TicketGroup = {
  sourceSheet: string;
  reimbursement: string;
  contract: string;
  product: string;
  cutDate: string;
  paymentDate: string;
  sales: TicketSale[];
  fees: TicketFee[];
  declaredGross: number | null;
  declaredFees: number | null;
  declaredAdvanced: number | null;
  declaredNet: number | null;
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

function headersAt(values: unknown[]) {
  return new Set(values.map(normalize));
}

function findHeaderIndex(matrix: unknown[][]) {
  return matrix.findIndex((values) => {
    const headers = headersAt(values);
    return [
      "numero do reembolso",
      "numero do contrato",
      "produto",
      "data de corte",
      "data de credito/debito",
      "data da transacao",
      "descricao do lancamento",
      "valor da transacao",
    ].every((header) => headers.has(header));
  });
}

export function isTicketDetailedSheet(
  sheetName: string,
  matrix: unknown[][],
) {
  return normalize(sheetName).includes("extrato de reembolso detalhado")
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

function effectiveRange(sheet: XLSX.WorkSheet) {
  const declared = sheet["!ref"]
    ? XLSX.utils.decode_range(sheet["!ref"])
    : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
  const end = { ...declared.e };
  Object.keys(sheet).forEach((address) => {
    if (address.startsWith("!") || !/^[A-Z]+\d+$/.test(address)) return;
    const cell = XLSX.utils.decode_cell(address);
    end.r = Math.max(end.r, cell.r);
    end.c = Math.max(end.c, cell.c);
  });
  return {
    firstSourceRow: declared.s.r + 1,
    range: XLSX.utils.encode_range({ s: declared.s, e: end }),
  };
}

function isFeeDescription(description: string) {
  return /^(?:tarifa|taxa)\b/.test(normalize(description));
}

function isAnticipationFee(description: string) {
  return /adiantamento|antecip/.test(normalize(description));
}

function rateValidation(chargedRate: number, rates: ContractedRate[]) {
  if (chargedRate <= 0) {
    return { rateValidation: "NOT_APPLICABLE" as const };
  }
  const contracted = selectContractedRate(rates, "VOUCHER", 1, "Ticket");
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

function groupIsValid(group: TicketGroup) {
  const gross = roundMoney(group.sales.reduce((sum, sale) => sum + sale.amount, 0));
  const fees = roundMoney(group.fees.reduce((sum, fee) => sum + fee.amount, 0));
  const net = roundMoney(gross - fees);
  return (group.declaredGross == null || Math.abs(group.declaredGross - gross) <= 0.01)
    && (group.declaredFees == null || Math.abs(group.declaredFees - fees) <= 0.01)
    && (group.declaredNet == null || Math.abs(group.declaredNet - net) <= 0.01)
    && (
      group.declaredAdvanced == null
      || group.declaredNet == null
      || Math.abs(group.declaredAdvanced - group.declaredNet) <= 0.01
    );
}

export async function parseTicketWorkbook(
  file: File,
  categories: Categories,
  manualPaymentDate: string,
  contractedRates: ContractedRate[],
  options: ParseTicketOptions = {},
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
  const groups: TicketGroup[] = [];
  const matchesByRule = Object.fromEntries(readingRules.map((rule) => [rule.id, 0]));
  const exclusionsByRule = Object.fromEntries(readingRules.map((rule) => [rule.id, 0]));
  const seenSales = new Set<string>();
  let excludedRows = 0;

  const evaluate = (row: Row, sheetName: string) => {
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
    return evaluation.excluded;
  };

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const sourceRange = effectiveRange(sheet);
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: true,
      range: sourceRange.range,
    });
    if (!isTicketDetailedSheet(sheetName, matrix)) continue;

    const headerIndex = findHeaderIndex(matrix);
    const headers = matrix[headerIndex];
    const firstSourceRow = sourceRange.firstSourceRow;
    processedSheets.push(sheetName);
    let currentGroup: TicketGroup | null = null;

    matrix.slice(headerIndex + 1).forEach((values, offset) => {
      const row = record(headers, values);
      const description = text(get(row, "descricao do lancamento"));
      const normalizedDescription = normalize(description);
      const amount = Math.abs(roundMoney(number(get(row, "valor da transacao"))));
      const reimbursement = text(get(row, "numero do reembolso"));
      const sourceRow = firstSourceRow + headerIndex + offset + 1;

      if (normalizedDescription === "compra" && reimbursement && amount > 0.009) {
        if (!currentGroup || currentGroup.reimbursement !== reimbursement) {
          currentGroup = {
            sourceSheet: sheetName,
            reimbursement,
            contract: text(get(row, "numero do contrato")),
            product: text(get(row, "produto")),
            cutDate: date(get(row, "data de corte")),
            paymentDate: date(get(row, "data de credito/debito")) || manualPaymentDate,
            sales: [],
            fees: [],
            declaredGross: null,
            declaredFees: null,
            declaredAdvanced: null,
            declaredNet: null,
          };
          groups.push(currentGroup);
        }

        const saleDate = date(get(row, "data da transacao"))
          || currentGroup.cutDate
          || currentGroup.paymentDate;
        const document = text(get(row, "numero do documento"));
        const card = text(get(row, "numero do cartao"));
        const deduplicationKey = [reimbursement, document, card, saleDate, amount].join("|");
        if (seenSales.has(deduplicationKey)) return;
        seenSales.add(deduplicationKey);
        const semanticRow: Row = {
          ...row,
          bandeira: "Ticket",
          modalidade: "Voucher",
          estabelecimento: get(row, "estabelecimento da compra"),
        };
        currentGroup.sales.push({
          row: semanticRow,
          sourceRow,
          saleDate,
          amount,
          excluded: evaluate(semanticRow, sheetName),
        });
        return;
      }

      if (!currentGroup || amount <= 0.009) return;
      if (normalizedDescription === "subtotal de vendas") {
        currentGroup.declaredGross = amount;
        return;
      }
      if (normalizedDescription === "total de descontos") {
        currentGroup.declaredFees = amount;
        return;
      }
      if (normalizedDescription === "valor antecipado") {
        currentGroup.declaredAdvanced = amount;
        return;
      }
      if (normalizedDescription === "valor liquido") {
        currentGroup.declaredNet = amount;
        return;
      }
      if (!isFeeDescription(description)) return;

      const semanticRow: Row = {
        ...row,
        bandeira: "Ticket",
        modalidade: "Voucher",
        descricao: description,
        "numero do reembolso": currentGroup.reimbursement,
        produto: currentGroup.product,
      };
      currentGroup.fees.push({
        row: semanticRow,
        sourceRow,
        description,
        amount,
        excluded: evaluate(semanticRow, sheetName),
      });
    });
  }

  if (processedSheets.length === 0) {
    throw new Error(
      "O arquivo não corresponde ao Extrato de Reembolso Detalhado da Ticket.",
    );
  }

  const lines: ParsedAcquirerLine[] = [];
  let nextId = 1;
  const push = (line: Omit<ParsedAcquirerLine, "id">) => {
    lines.push({ id: nextId++, ...line });
  };

  groups.forEach((group) => {
    const valid = groupIsValid(group);
    const gross = roundMoney(group.sales.reduce((sum, sale) => sum + sale.amount, 0));
    const tpe = roundMoney(group.fees
      .filter((fee) => normalize(fee.description).includes("taxa tpe"))
      .reduce((sum, fee) => sum + fee.amount, 0));
    const chargedRate = gross > 0 ? (tpe / gross) * 100 : 0;
    const validation = rateValidation(chargedRate, contractedRates);
    const groupDetails = [
      group.product || "BENEFÍCIO",
      `reembolso ${group.reimbursement}`,
      group.contract ? `contrato ${group.contract}` : "",
    ].filter(Boolean).join(" - ");

    group.sales.forEach((sale) => {
      if (sale.excluded) return;
      const document = text(get(sale.row, "numero do documento"));
      const details = [groupDetails, document ? `doc. ${document}` : ""]
        .filter(Boolean)
        .join(" - ");
      push({
        sourceSheet: group.sourceSheet,
        sourceRow: sale.sourceRow,
        eventType: "SALE",
        saleDate: sale.saleDate,
        dueDate: group.paymentDate,
        paymentDate: group.paymentDate,
        description: `VENDA TICKET - ${details}`,
        category: categories.sale,
        amount: sale.amount,
        anticipated: false,
        status: !valid || validation.rateValidation === "DIVERGENT" ? "REVIEW" : "OK",
        rateValidation: validation.rateValidation,
        chargedRate: chargedRate || undefined,
        contractedRate: "contractedRate" in validation
          ? validation.contractedRate
          : undefined,
        acquirer: "TICKET",
        transactionType: "VOUCHER",
        cardBrand: "Ticket",
        installments: 1,
        sourceMetadata: {
          ...sourceMetadata(sale.row),
          numero_reembolso: group.reimbursement,
        },
      });
    });

    group.fees.forEach((fee) => {
      if (fee.excluded) return;
      const anticipation = isAnticipationFee(fee.description);
      push({
        sourceSheet: group.sourceSheet,
        sourceRow: fee.sourceRow,
        eventType: anticipation ? "ANTICIPATION" : "FEE",
        saleDate: group.cutDate || group.paymentDate,
        dueDate: group.paymentDate,
        paymentDate: group.paymentDate,
        description: `${fee.description.toUpperCase()} TICKET - ${groupDetails}`,
        category: anticipation ? categories.anticipation : categories.fee,
        amount: -fee.amount,
        anticipated: anticipation,
        status: valid ? "OK" : "REVIEW",
        rateValidation: "NOT_APPLICABLE",
        chargedRate: normalize(fee.description).includes("taxa tpe")
          ? chargedRate || undefined
          : undefined,
        acquirer: "TICKET",
        transactionType: "VOUCHER",
        cardBrand: "Ticket",
        installments: 1,
        feeCategory: anticipation ? "ANTICIPATION" : (
          normalize(fee.description).includes("taxa tpe") ? "SALE_FEE" : "OTHER"
        ),
        sourceMetadata: {
          ...sourceMetadata(fee.row),
          numero_reembolso: group.reimbursement,
        },
      });
    });
  });

  const sourceRows = groups.reduce((sum, group) => sum + group.sales.length, 0);
  const sourceGross = roundMoney(groups.reduce((sum, group) => (
    sum + (group.declaredGross ?? group.sales.reduce((subtotal, sale) => subtotal + sale.amount, 0))
  ), 0));
  const sourceFees = roundMoney(groups.reduce((sum, group) => (
    sum + (group.declaredFees ?? group.fees.reduce((subtotal, fee) => subtotal + fee.amount, 0))
  ), 0));
  const sourceNet = roundMoney(groups.reduce((sum, group) => (
    sum + (group.declaredNet ?? (
      group.sales.reduce((subtotal, sale) => subtotal + sale.amount, 0)
      - group.fees.reduce((subtotal, fee) => subtotal + fee.amount, 0)
    ))
  ), 0));

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
      net: sourceRows ? sourceNet : null,
    },
  };
}
