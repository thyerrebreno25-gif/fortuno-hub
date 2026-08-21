import * as XLSX from "xlsx";
import { selectContractedRate } from "./contracted-rate-matcher";
import {
  evaluateReadingInstructions,
  type AcquirerReadingRule,
} from "./reading-instructions";

export type AcquirerEventType =
  | "SALE"
  | "FEE"
  | "ADJUSTMENT"
  | "CANCELLATION"
  | "CHARGEBACK"
  | "ANTICIPATION";

export type FeeCategory =
  | "SALE_FEE"
  | "ANTICIPATION"
  | "EQUIPMENT"
  | "ADJUSTMENT"
  | "CHARGEBACK"
  | "CANCELLATION"
  | "OTHER";

export type ContractedRate = {
  modality: string;
  installments: number | null;
  cardBrand: string | null;
  rate: number;
  tolerance: number;
};

export type ParsedAcquirerLine = {
  id: number;
  sourceSheet: string;
  sourceRow: number;
  eventType: AcquirerEventType;
  saleDate: string;
  dueDate: string;
  paymentDate: string;
  description: string;
  category: string;
  amount: number;
  anticipated: boolean;
  status: "OK" | "REVIEW";
  rateValidation: "MATCH" | "DIVERGENT" | "NOT_CONFIGURED" | "NOT_APPLICABLE";
  chargedRate?: number;
  contractedRate?: number;
  acquirer?: string;
  transactionType?: "DEBIT" | "CREDIT" | "PIX" | "VOUCHER" | "OTHER";
  cardBrand?: string;
  installments?: number;
  feeCategory?: FeeCategory;
  sourceMetadata?: Record<string, string | number | boolean | null>;
};

export type RedeSourceTotals = {
  rows: number | null;
  gross: number | null;
  fees: number | null;
  net: number | null;
};

export type Categories = {
  sale: string;
  fee: string;
  adjustment: string;
  cancellation: string;
  chargeback: string;
  anticipation: string;
};

export type ReadingInstructionSummary = {
  rules: AcquirerReadingRule[];
  excludedRows: number;
  matchesByRule: Record<string, number>;
  exclusionsByRule: Record<string, number>;
  unmatchedRuleIds: string[];
};

type ParseRedeOptions = {
  readingRules?: AcquirerReadingRule[];
};

type Row = Record<string, unknown>;

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

const date = (value: unknown): string => {
  if (!value || value === "-") return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  const raw = String(value).trim();
  const br = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (br) return `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : "";
};

function record(headers: unknown[], values: unknown[]): Row {
  return Object.fromEntries(headers.map((header, index) => [normalize(header), values[index]]));
}

function get(row: Row, ...keys: string[]) {
  for (const key of keys) {
    const value = row[normalize(key)];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function getPreferredNumber(row: Row, preferredKey: string, fallbackKey: string) {
  const preferred = get(row, preferredKey);
  return preferred !== undefined && preferred !== null && preferred !== "-"
    ? number(preferred)
    : number(get(row, fallbackKey));
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function rowMetadata(row: Row) {
  return Object.fromEntries(
    Object.entries(row).flatMap(([key, value]) => {
      if (value === undefined || value === null || value === "" || value === "-") {
        return [];
      }
      if (value instanceof Date) {
        return [[key, value.toISOString()]];
      }
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        return [[key, value]];
      }
      return [[key, String(value)]];
    }),
  );
}

function normalizeModality(value: unknown): "DEBIT" | "CREDIT" | "PIX" | "VOUCHER" | "OTHER" {
  const normalized = normalize(value);
  if (normalized === "debit" || normalized.includes("debito")) return "DEBIT";
  if (normalized === "credit" || normalized.includes("credito")) return "CREDIT";
  if (normalized === "pix" || normalized.includes("pix")) return "PIX";
  if (normalized === "voucher" || normalized.includes("voucher")) return "VOUCHER";
  if (normalized === "other" || normalized.includes("outro")) return "OTHER";
  return "OTHER";
}

function normalizeBrand(value: unknown) {
  return normalize(value).replace(/[^a-z0-9]/g, "").toUpperCase();
}


function classifyFeeCategory(
  eventType: AcquirerEventType,
  description: string,
  sourceSheet: string,
): FeeCategory | undefined {
  if (eventType === "SALE") return undefined;
  if (eventType === "FEE") return "SALE_FEE";
  if (eventType === "ANTICIPATION") return "ANTICIPATION";
  if (eventType === "CHARGEBACK") return "CHARGEBACK";
  if (eventType === "CANCELLATION") return "CANCELLATION";

  const content = normalize(`${description} ${sourceSheet}`);

  if (
    /antecip|cessao|cessão|desagendamento|recebimento antecipado|custo financeiro/.test(
      content,
    )
  ) {
    return "ANTICIPATION";
  }

  if (
    /aluguel|maquin|maquininha|terminal|pos\b|smart pos|mensalidade|conectividade|equipamento|manutencao|manutenção/.test(
      content,
    )
  ) {
    return "EQUIPMENT";
  }

  if (/chargeback|contestacao|contestação/.test(content)) {
    return "CHARGEBACK";
  }

  if (/cancelamento|cancelada|cancelado/.test(content)) {
    return "CANCELLATION";
  }

  if (
    /ajuste|bloqueio|retencao|retenção|penhora|cobranca|cobrança|devolucao|devolução|credito|crédito|debito|débito/.test(
      content,
    )
  ) {
    return "ADJUSTMENT";
  }

  return "OTHER";
}


function displayBrand(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  const key = normalizeBrand(raw);
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
    SOROCRED: "Sorocred",
  };
  return known[key] ?? raw;
}

function displayModality(value: unknown) {
  return { DEBIT: "Débito", CREDIT: "Crédito", PIX: "PIX", VOUCHER: "Voucher", OTHER: "Outro" }[normalizeModality(value)];
}

function validateRate(
  chargedRate: number,
  modality: unknown,
  installments: unknown,
  brand: unknown,
  rates: ContractedRate[],
) {
  if (!chargedRate) {
    return { rateValidation: "NOT_APPLICABLE" as const };
  }
  if (rates.length === 0) {
    return { rateValidation: "NOT_CONFIGURED" as const };
  }

  const originalInstallments = Math.max(1, Math.trunc(number(installments) || 1));
  const contracted = selectContractedRate(
    rates,
    normalizeModality(modality),
    originalInstallments,
    brand,
  );

  if (!contracted) return { rateValidation: "NOT_CONFIGURED" as const };
  const tolerance = Number(contracted.tolerance || 0);
  const contractedRate = Number(contracted.rate);
  const roundedChargedRate = Math.round(chargedRate * 10000) / 10000;
  const roundedContractedRate = Math.round(contractedRate * 10000) / 10000;
  const difference = Math.abs(roundedChargedRate - roundedContractedRate);
  const comparisonEpsilon = 0.000001;
  return {
    rateValidation: difference <= tolerance + comparisonEpsilon ? "MATCH" as const : "DIVERGENT" as const,
    contractedRate: roundedContractedRate,
  };
}


function rateFromValues(explicitRate: number, fee: number, gross: number) {
  if (explicitRate > 0) {
    // A REDE normalmente entrega 0,007 para representar 0,70%.
    return explicitRate <= 1 ? explicitRate * 100 : explicitRate;
  }
  return gross !== 0 && fee !== 0 ? Math.abs(fee / gross) * 100 : 0;
}

export async function parseRedeWorkbook(
  file: File,
  categories: Categories,
  manualPaymentDate: string,
  contractedRates: ContractedRate[],
  options: ParseRedeOptions = {},
): Promise<{
  lines: ParsedAcquirerLine[];
  processedSheets: string[];
  sourceRows: number;
  sourceTotals: RedeSourceTotals;
  instructionSummary: ReadingInstructionSummary;
}> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const lines: ParsedAcquirerLine[] = [];
  const processedSheets = workbook.SheetNames.filter((sheetName) => normalize(sheetName) !== "capa");
  const readingRules = options.readingRules ?? [];
  const matchesByRule = Object.fromEntries(readingRules.map((rule) => [rule.id, 0]));
  const exclusionsByRule = Object.fromEntries(readingRules.map((rule) => [rule.id, 0]));
  let excludedRows = 0;
  let id = 1;

  type ParsedSourceRow = {
    row: Row;
    sourceRow: number;
  };

  type ParsedSheet = {
    name: string;
    key: string;
    rows: ParsedSourceRow[];
  };

  const sheets: ParsedSheet[] = processedSheets.map((sheetName) => {
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
      header: 1,
      defval: null,
      raw: true,
    });
    const headers = matrix[1] ?? [];
    return {
      name: sheetName,
      key: normalize(sheetName),
      rows: matrix.slice(2).flatMap((values, offset) =>
        values.some((value) => value !== null && value !== "")
          ? [{ row: record(headers, values), sourceRow: offset + 3 }]
          : [],
      ),
    };
  });

  const sourceRows = sheets.reduce((total, sheet) => total + sheet.rows.length, 0);
  const includedInPrepass = (sheetName: string, row: Row) =>
    !evaluateReadingInstructions(row, sheetName, readingRules).excluded;
  const eventTypeFromCancellation = (value: unknown): "CANCELLATION" | "CHARGEBACK" => {
    const kind = normalize(value);
    return kind.includes("chargeback") || kind.includes("contest")
      ? "CHARGEBACK"
      : "CANCELLATION";
  };
  const eventKey = (
    eventType: "CANCELLATION" | "CHARGEBACK",
    eventDate: string,
    batch: unknown,
    value: number,
  ) => [eventType, eventDate, normalize(batch), roundMoney(Math.abs(value)).toFixed(2)].join("|");

  // A Rede replica cancelamentos e chargebacks tanto em "ajustes" quanto na aba
  // específica. Esta última é a fonte canônica porque contém NSU, TID e autorização.
  const canonicalEventCounts = new Map<string, number>();
  const cancellationsByNsu = new Map<string, { original: number; discounted: number }>();
  for (const sheet of sheets.filter((item) => item.key === "cancelamentos e contestacoes")) {
    for (const { row } of sheet.rows) {
      if (!includedInPrepass(sheet.name, row)) continue;
      const eventType = eventTypeFromCancellation(get(row, "cancelamento/chargeback"));
      const value = number(get(row, "valor descontado", "valor original da venda"));
      const eventDate = date(get(row, "data do débito", "data original da venda")) || manualPaymentDate;
      const batch = get(row, "resumo de vendas/número do lote ajustado");
      const key = eventKey(eventType, eventDate, batch, value);
      canonicalEventCounts.set(key, (canonicalEventCounts.get(key) ?? 0) + 1);

      const nsu = normalize(get(row, "NSU/CV"));
      if (!nsu) continue;
      const current = cancellationsByNsu.get(nsu) ?? { original: 0, discounted: 0 };
      current.original = Math.max(current.original, number(get(row, "valor original da venda")));
      current.discounted = roundMoney(current.discounted + Math.abs(value));
      cancellationsByNsu.set(nsu, current);
    }
  }

  const paymentSheet = sheets.find((sheet) => sheet.key === "pagamentos");
  const hasDetailedPayments = Boolean(
    paymentSheet?.rows.some(({ row }) => includedInPrepass(paymentSheet.name, row)),
  );
  let receivedRows = 0;
  let receivedNet = 0;
  for (const sheet of sheets.filter((item) => item.key === "recebidos")) {
    for (const { row } of sheet.rows) {
      const deposited = number(get(row, "valor depositado"));
      if (deposited === 0) continue;
      receivedRows += 1;
      receivedNet = roundMoney(receivedNet + deposited);
    }
  }

  const remainingCanonicalEvents = new Map(canonicalEventCounts);
  const recoveredCanceledSales = new Set<string>();

  const push = (line: Omit<ParsedAcquirerLine, "id">) =>
    lines.push({
      id: id++,
      ...line,
      feeCategory:
        line.feeCategory ??
        classifyFeeCategory(line.eventType, line.description, line.sourceSheet),
    });

  for (const sheet of sheets) {
    const sheetName = sheet.name;
    const sheetKey = sheet.key;
    sheet.rows.forEach(({ row, sourceRow }) => {
      const instructionEvaluation = evaluateReadingInstructions(
        row,
        sheetName,
        readingRules,
      );
      instructionEvaluation.matchedRuleIds.forEach((ruleId) => {
        matchesByRule[ruleId] = (matchesByRule[ruleId] ?? 0) + 1;
      });
      if (instructionEvaluation.excluded) {
        excludedRows += 1;
        instructionEvaluation.exclusionRuleIds.forEach((ruleId) => {
          exclusionsByRule[ruleId] = (exclusionsByRule[ruleId] ?? 0) + 1;
        });
        return;
      }
      const brand = get(row, "bandeira", "bandeira da venda", "bandeira ajustada", "bandeira do recebimento");
      const modality = get(row, "modalidade", "modalidade da venda", "modalidade ajustada", "tipo de produto");
      const installmentsRaw = get(row, "número de parcelas", "numero de parcelas", "parcelas", "quantidade de parcelas");
      const installmentCount = Math.max(1, Math.trunc(number(installmentsRaw) || 1));
      const transactionType = normalizeModality(modality);
      const cardBrand = transactionType === "PIX" ? "" : displayBrand(brand);
      const establishment = text(get(row, "nome do estabelecimento", "nome do estabelecimento da venda", "nome do estabelecimento cobrado"));
      const descriptor = [cardBrand, displayModality(modality), transactionType === "CREDIT" ? `${installmentCount}x` : "", establishment].filter(Boolean).join(" - ");

      if (sheetKey === "pagamentos") {
        const originalGross = number(get(row, "valor bruto da parcela original", "valor bruto da parcela"));
        let gross = getPreferredNumber(
          row,
          "valor bruto da parcela atualizada",
          "valor bruto da parcela original",
        );
        let fee = Math.abs(number(get(row, "valor MDR descontado")));
        const saleDate = date(get(row, "data original da venda"));
        const dueDate = date(get(row, "data original de vencimento", "data prevista do recebimento"));
        const paymentDate = date(get(row, "data do recebimento")) || manualPaymentDate;
        const nsu = text(get(row, "NSU/CV"));
        const normalizedNsu = normalize(nsu);
        const paymentStatus = normalize(get(row, "status"));
        const cancellation = cancellationsByNsu.get(normalizedNsu);

        // Uma venda desagendada tem bruto atualizado zero. Quando o próprio relatório
        // traz o cancelamento debitado no período, recompomos bruto e MDR para que a
        // venda + tarifa + cancelamento fechem exatamente em zero.
        if (gross === 0 && paymentStatus.includes("desagendada")) {
          if (cancellation && !recoveredCanceledSales.has(normalizedNsu)) {
            gross = originalGross || cancellation.original;
            fee = roundMoney(Math.max(0, gross - cancellation.discounted));
            recoveredCanceledSales.add(normalizedNsu);
          } else {
            return;
          }
        }
        if (gross === 0) return;

        const chargedRate = rateFromValues(number(get(row, "taxa MDR")), fee, gross);
        const validation = validateRate(
          chargedRate,
          transactionType,
          installmentCount,
          cardBrand,
          contractedRates,
        );
        const negotiated = normalize(get(row, "negociada"));
        const anticipated = paymentStatus.includes("antecipada") || Boolean(negotiated && !negotiated.includes("livre"));
        const identifiers = [
          nsu ? `NSU ${nsu}` : "",
          text(get(row, "número da autorização")) ? `AUT. ${text(get(row, "número da autorização"))}` : "",
        ].filter(Boolean).join(" - ");
        const metadata = rowMetadata(row);

        push({
          sourceSheet: sheetName,
          sourceRow,
          eventType: "SALE",
          saleDate,
          dueDate,
          paymentDate,
          description: `VENDA REDE ${descriptor}${identifiers ? ` - ${identifiers}` : ""}`.trim(),
          category: categories.sale,
          amount: roundMoney(gross),
          anticipated,
          status: validation.rateValidation === "DIVERGENT" ? "REVIEW" : "OK",
          rateValidation: validation.rateValidation,
          chargedRate: chargedRate || undefined,
          contractedRate: "contractedRate" in validation ? validation.contractedRate : undefined,
          acquirer: "REDE",
          transactionType,
          cardBrand: cardBrand || undefined,
          installments: installmentCount,
          sourceMetadata: metadata,
        });
        if (fee !== 0) push({
          sourceSheet: sheetName,
          sourceRow,
          eventType: "FEE",
          saleDate,
          dueDate,
          paymentDate,
          description: `TAXA MDR REDE ${descriptor}${identifiers ? ` - ${identifiers}` : ""}`.trim(),
          category: categories.fee,
          amount: -roundMoney(Math.abs(fee)),
          anticipated,
          status: "OK",
          rateValidation: "NOT_APPLICABLE",
          acquirer: "REDE",
          transactionType,
          cardBrand: cardBrand || undefined,
          installments: installmentCount,
          sourceMetadata: metadata,
        });
        return;
      }

      if (sheetKey === "pagamentos futuros" || sheetKey === "bloqueados suspenso") {
        // São agendas, não movimentações efetivamente recebidas. Continuam contadas
        // como linhas-fonte, mas não entram no financeiro nem na exportação atual.
        return;
      }

      if (sheetKey === "ajustes") {
        const adjustmentDate = date(get(row, "data do ajuste", "data do lançamento")) || manualPaymentDate;
        const reason = text(get(row, "motivo", "tipo do ajuste")) || "Ajuste";
        const charged = number(get(row, "valor cobrado nesta data"));
        const credited = number(get(row, "valor creditado nesta data"));
        const normalizedReason = normalize(reason);
        const isAnticipation = normalizedReason.includes("antecipacao");
        const adjustmentEventType: AcquirerEventType = isAnticipation
          ? "ANTICIPATION"
          : normalizedReason.includes("contest") || normalizedReason.includes("chargeback")
            ? "CHARGEBACK"
            : normalizedReason.includes("cancel")
              ? "CANCELLATION"
              : "ADJUSTMENT";
        const category = adjustmentEventType === "ANTICIPATION"
          ? categories.anticipation
          : adjustmentEventType === "CHARGEBACK"
            ? categories.chargeback
            : adjustmentEventType === "CANCELLATION"
              ? categories.cancellation
              : categories.adjustment;
        const metadata = rowMetadata(row);

        let duplicateOfCanonical = false;
        if (charged !== 0 && (adjustmentEventType === "CANCELLATION" || adjustmentEventType === "CHARGEBACK")) {
          const duplicateKey = eventKey(
            adjustmentEventType,
            adjustmentDate,
            get(row, "resumo de vendas/número do lote ajustado"),
            charged,
          );
          const remaining = remainingCanonicalEvents.get(duplicateKey) ?? 0;
          if (remaining > 0) {
            duplicateOfCanonical = true;
            remainingCanonicalEvents.set(duplicateKey, remaining - 1);
          }
        }

        if (charged !== 0 && !duplicateOfCanonical) push({
          sourceSheet: sheetName,
          sourceRow,
          eventType: adjustmentEventType,
          saleDate: adjustmentDate,
          dueDate: adjustmentDate,
          paymentDate: adjustmentDate,
          description: reason.toUpperCase(),
          category,
          amount: -roundMoney(Math.abs(charged)),
          anticipated: isAnticipation,
          status: "OK",
          rateValidation: "NOT_APPLICABLE",
          sourceMetadata: metadata,
        });
        if (credited !== 0) push({
          sourceSheet: sheetName,
          sourceRow,
          eventType: "ADJUSTMENT",
          saleDate: adjustmentDate,
          dueDate: adjustmentDate,
          paymentDate: adjustmentDate,
          description: `DEVOLUÇÃO - ${reason}`.toUpperCase(),
          category: categories.adjustment,
          amount: roundMoney(Math.abs(credited)),
          anticipated: false,
          status: "OK",
          rateValidation: "NOT_APPLICABLE",
          sourceMetadata: metadata,
        });
        return;
      }

      if (sheetKey === "cancelamentos e contestacoes") {
        const eventType = eventTypeFromCancellation(get(row, "cancelamento/chargeback"));
        const value = number(get(row, "valor descontado", "valor original da venda"));
        const eventDate = date(get(row, "data do débito", "data original da venda")) || manualPaymentDate;
        const cancellationModality = get(row, "modalidade da venda");
        const cancellationType = normalizeModality(cancellationModality);
        const cancellationBrand = displayBrand(get(row, "bandeira da venda"));
        const cancellationInstallments = Math.max(1, Math.trunc(number(get(row, "número de parcelas")) || 1));
        if (value !== 0) push({
          sourceSheet: sheetName,
          sourceRow,
          eventType,
          saleDate: date(get(row, "data original da venda")),
          dueDate: eventDate,
          paymentDate: eventDate,
          description: text(get(row, "motivo do cancelamento")) || eventType,
          category: eventType === "CHARGEBACK" ? categories.chargeback : categories.cancellation,
          amount: -roundMoney(Math.abs(value)),
          anticipated: false,
          status: "OK",
          rateValidation: "NOT_APPLICABLE",
          acquirer: "REDE",
          transactionType: cancellationType,
          cardBrand: cancellationBrand || undefined,
          installments: cancellationInstallments,
          sourceMetadata: rowMetadata(row),
        });
        return;
      }

      if (sheetKey === "recebidos") {
        const depositedValue = number(get(row, "valor depositado"));
        const eventDate = date(get(row, "data")) || manualPaymentDate;
        if (hasDetailedPayments) return;
        const receivedBrand = get(row, "bandeira", "bandeira do recebimento") ?? brand;
        const receivedModality = get(row, "modalidade", "modalidade do recebimento") ?? modality;
        const receivedEstablishment = text(get(row, "nome do estabelecimento", "estabelecimento")) || establishment;
        const finalType = normalizeModality(receivedModality);
        const finalBrand = finalType === "PIX" ? "" : displayBrand(receivedBrand);
        const finalInstallments = 1;
        const receivedDescriptor = [
          finalBrand,
          displayModality(finalType),
          finalType === "CREDIT" ? (finalInstallments > 1 ? "Parcelado" : "À vista") : "À vista",
          receivedEstablishment,
        ].filter(Boolean).join(" - ");

        if (depositedValue !== 0) push({
          sourceSheet: sheetName,
          sourceRow,
          eventType: "SALE",
          saleDate: eventDate,
          dueDate: eventDate,
          paymentDate: eventDate,
          description: `RECEBIMENTO ${receivedDescriptor}`.trim(),
          category: categories.sale,
          amount: roundMoney(depositedValue),
          anticipated: Boolean(normalize(get(row, "negociadas")) && !normalize(get(row, "negociadas")).includes("livre")),
          status: "OK",
          rateValidation: "NOT_APPLICABLE",
          acquirer: "REDE",
          transactionType: finalType,
          cardBrand: finalBrand || undefined,
          installments: finalInstallments,
          sourceMetadata: rowMetadata(row),
        });
        return;
      }

      if (sheetKey === "bloqueados retido e penhorado") {
        const value = number(get(row, "valor do bloqueio"));
        const eventDate = date(get(row, "data do bloqueio")) || manualPaymentDate;
        if (value !== 0) push({ sourceSheet: sheetName, sourceRow, eventType: "ADJUSTMENT", saleDate: eventDate, dueDate: eventDate, paymentDate: eventDate, description: `BLOQUEIO - ${text(get(row, "tipo do bloqueio"))}`.trim(), category: categories.adjustment, amount: -Math.abs(value), anticipated: false, status: "REVIEW", rateValidation: "NOT_APPLICABLE", sourceMetadata: rowMetadata(row) });
        return;
      }

      if (sheetKey === "desagendamentos de cessao") {
        const current = number(get(row, "valor desagendado neste pagamento"));
        const future = number(get(row, "valor desagendamento no pagamento futuro"));
        const eventDate = date(get(row, "data do recebimento desagendado", "data prevista para desagendamento")) || manualPaymentDate;
        for (const [label, value] of [["DESAGENDAMENTO", current], ["DESAGENDAMENTO FUTURO", future]] as const) {
          if (value !== 0) push({ sourceSheet: sheetName, sourceRow, eventType: "ADJUSTMENT", saleDate: date(get(row, "data original da venda")), dueDate: eventDate, paymentDate: eventDate, description: label, category: categories.adjustment, amount: -Math.abs(value), anticipated: false, status: "REVIEW", rateValidation: "NOT_APPLICABLE", sourceMetadata: rowMetadata(row) });
        }
        return;
      }

      if (sheetKey === "cobrancas em aberto") {
        const value = number(get(row, "valor pendente", "total da cobrança"));
        const eventDate = date(get(row, "data de criação do débito")) || manualPaymentDate;
        if (value !== 0) push({ sourceSheet: sheetName, sourceRow, eventType: "ADJUSTMENT", saleDate: eventDate, dueDate: eventDate, paymentDate: eventDate, description: text(get(row, "motivo")) || "COBRANÇA EM ABERTO", category: categories.adjustment, amount: -Math.abs(value), anticipated: false, status: "REVIEW", rateValidation: "NOT_APPLICABLE", sourceMetadata: rowMetadata(row) });
      }
    });
  }

  const parsedGross = roundMoney(
    lines.filter((line) => line.eventType === "SALE").reduce((total, line) => total + line.amount, 0),
  );
  const identifiedNet = roundMoney(lines.reduce((total, line) => total + line.amount, 0));
  const reconciledNet = receivedRows > 0 ? receivedNet : identifiedNet;
  const reconciledGross = hasDetailedPayments ? parsedGross : reconciledNet;
  const sourceTotals: RedeSourceTotals = {
    rows: receivedRows > 0
      ? receivedRows
      : lines.filter((line) => line.eventType === "SALE").length,
    gross: reconciledGross,
    fees: roundMoney(Math.max(0, reconciledGross - reconciledNet)),
    net: reconciledNet,
  };

  return {
    lines,
    processedSheets,
    sourceRows,
    sourceTotals,
    instructionSummary: {
      rules: readingRules,
      excludedRows,
      matchesByRule,
      exclusionsByRule,
      unmatchedRuleIds: readingRules
        .filter((rule) => (matchesByRule[rule.id] ?? 0) === 0)
        .map((rule) => rule.id),
    },
  };
}
