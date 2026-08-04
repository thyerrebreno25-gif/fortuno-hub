import * as XLSX from "xlsx";

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
};

type Categories = {
  sale: string;
  fee: string;
  adjustment: string;
  cancellation: string;
  chargeback: string;
  anticipation: string;
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

function getFirstNonZeroNumber(row: Row, ...keys: string[]) {
  for (const key of keys) {
    const parsed = number(row[normalize(key)]);
    if (parsed !== 0) return parsed;
  }
  return 0;
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

  const normalizedModality = normalizeModality(modality);
  const originalInstallments = Math.max(1, Math.trunc(number(installments) || 1));
  const paymentForm = normalizedModality === "CREDIT" && originalInstallments > 1 ? 2 : 1;
  const normalizedBrand = normalizeBrand(brand);
  const candidates = rates.filter((rate) =>
    normalizeModality(rate.modality) === normalizedModality &&
    (rate.installments == null || Number(rate.installments) === paymentForm),
  );
  const specific = candidates.find((rate) => normalizeBrand(rate.cardBrand) === normalizedBrand);
  const general = candidates.find((rate) => !normalizeBrand(rate.cardBrand) || normalize(rate.cardBrand) === "todas");
  const contracted = specific ?? general;

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


type PaymentAggregate = {
  gross: number;
  fee: number;
  chargedRate: number;
  brand: string;
  modality: "DEBIT" | "CREDIT" | "PIX" | "VOUCHER" | "OTHER";
  installments?: number;
  mixedInstallments: boolean;
  establishment: string;
};

function aggregateBaseKey(
  paymentDate: string,
  brand: unknown,
  modality: unknown,
  establishment: unknown,
) {
  return [
    paymentDate,
    normalizeBrand(brand) || "NO_BRAND",
    normalizeModality(modality),
    normalize(establishment) || "NO_ESTABLISHMENT",
  ].join("|");
}

function aggregateKey(
  paymentDate: string,
  brand: unknown,
  modality: unknown,
  establishment: unknown,
  paymentForm: number,
) {
  return `${aggregateBaseKey(paymentDate, brand, modality, establishment)}|${paymentForm}`;
}

function rateFromValues(explicitRate: number, fee: number, gross: number) {
  if (explicitRate > 0) {
    // A REDE normalmente entrega 0,007 para representar 0,70%.
    return explicitRate <= 1 ? explicitRate * 100 : explicitRate;
  }
  return gross !== 0 && fee !== 0 ? Math.abs(fee / gross) * 100 : 0;
}

function findBestPaymentAggregate(
  aggregates: Map<string, PaymentAggregate>,
  baseKey: string,
  depositedValue: number,
) {
  const candidates = Array.from(aggregates.entries())
    .filter(([key]) => key.startsWith(`${baseKey}|`))
    .map(([, aggregate]) => aggregate);

  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];

  return candidates.reduce((best, candidate) => {
    const candidateNet = candidate.gross - candidate.fee;
    const bestNet = best.gross - best.fee;
    return Math.abs(candidateNet - depositedValue) < Math.abs(bestNet - depositedValue)
      ? candidate
      : best;
  });
}

export async function parseRedeWorkbook(
  file: File,
  categories: Categories,
  manualPaymentDate: string,
  contractedRates: ContractedRate[],
): Promise<{ lines: ParsedAcquirerLine[]; processedSheets: string[]; sourceRows: number }> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const lines: ParsedAcquirerLine[] = [];
  const processedSheets: string[] = [];
  let sourceRows = 0;
  let id = 1;
  const paymentAggregates = new Map<string, PaymentAggregate>();

  // Primeira passagem: consolida os detalhes de pagamentos para enriquecer a aba recebidos.
  for (const sheetName of workbook.SheetNames) {
    const sheetKey = normalize(sheetName);
    if (!["pagamentos", "pagamentos futuros", "bloqueados suspenso"].includes(sheetKey)) continue;

    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true });
    if (matrix.length < 3) continue;
    const headers = matrix[1] ?? [];

    matrix.slice(2).forEach((values) => {
      if (!values.some((value) => value !== null && value !== "")) return;
      const row = record(headers, values);
      const paymentDate = date(get(row, "data do recebimento"));
      if (!paymentDate) return;

      const brand = get(row, "bandeira", "bandeira da venda");
      const modalityRaw = get(row, "modalidade", "modalidade da venda", "tipo de produto");
      const establishment = text(get(row, "nome do estabelecimento", "nome do estabelecimento da venda"));
      const originalInstallments = Math.max(1, Math.trunc(number(get(row, "número de parcelas", "numero de parcelas", "parcelas")) || 1));
      const installments = normalizeModality(modalityRaw) === "CREDIT" && originalInstallments > 1 ? 2 : 1;
      const gross = getFirstNonZeroNumber(row, "valor bruto da parcela atualizada", "valor bruto da parcela original", "valor bruto da parcela");
      const fee = Math.abs(number(get(row, "valor MDR descontado")));
      const explicitRate = number(get(row, "taxa MDR"));
      const key = aggregateKey(paymentDate, brand, modalityRaw, establishment, installments);
      const current = paymentAggregates.get(key);
      const modality = normalizeModality(modalityRaw);

      if (!current) {
        paymentAggregates.set(key, {
          gross,
          fee,
          chargedRate: 0,
          brand: displayBrand(brand),
          modality,
          installments,
          mixedInstallments: false,
          establishment,
        });
      } else {
        current.gross += gross;
        current.fee += fee;
        current.installments = installments;
        current.mixedInstallments = false;
      }

      const aggregate = paymentAggregates.get(key)!;
      aggregate.chargedRate = rateFromValues(explicitRate, aggregate.fee, aggregate.gross);
    });
  }

  const push = (line: Omit<ParsedAcquirerLine, "id">) =>
    lines.push({
      id: id++,
      ...line,
      feeCategory:
        line.feeCategory ??
        classifyFeeCategory(line.eventType, line.description, line.sourceSheet),
    });

  for (const sheetName of workbook.SheetNames) {
    if (normalize(sheetName) === "capa") continue;
    processedSheets.push(sheetName);
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true });
    if (matrix.length < 3) continue;
    const headers = matrix[1] ?? [];

    matrix.slice(2).forEach((values, offset) => {
      if (!values.some((value) => value !== null && value !== "")) return;
      sourceRows += 1;
      const row = record(headers, values);
      const sourceRow = offset + 3;
      const sheetKey = normalize(sheetName);
      const brand = get(row, "bandeira", "bandeira da venda", "bandeira ajustada", "bandeira do recebimento");
      const modality = get(row, "modalidade", "modalidade da venda", "modalidade ajustada", "tipo de produto");
      const installmentsRaw = get(row, "número de parcelas", "numero de parcelas", "parcelas", "quantidade de parcelas");
      const installmentCount = Math.max(1, Math.trunc(number(installmentsRaw) || 1));
      const transactionType = normalizeModality(modality);
      const cardBrand = transactionType === "PIX" ? "" : displayBrand(brand);
      const establishment = text(get(row, "nome do estabelecimento", "nome do estabelecimento da venda", "nome do estabelecimento cobrado"));
      const descriptor = [cardBrand, displayModality(modality), transactionType === "CREDIT" ? `${installmentCount}x` : "", establishment].filter(Boolean).join(" - ");

      if (sheetKey === "pagamentos" || sheetKey === "pagamentos futuros" || sheetKey === "bloqueados suspenso") {
        const gross = getFirstNonZeroNumber(row, "valor bruto da parcela atualizada", "valor bruto da parcela original", "valor bruto da parcela");
        const fee = number(get(row, "valor MDR descontado"));
        const saleDate = date(get(row, "data original da venda"));
        const dueDate = date(get(row, "data original de vencimento", "data prevista do recebimento"));
        const paymentDate = date(get(row, "data do recebimento")) || manualPaymentDate;
        // A venda será representada na aba recebidos. Aqui mantemos somente a tarifa detalhada.
        if (fee !== 0) push({ sourceSheet: sheetName, sourceRow, eventType: "FEE", saleDate, dueDate, paymentDate, description: `TAXA MDR ${descriptor}`.trim(), category: categories.fee, amount: -Math.abs(fee), anticipated: false, status: "OK", rateValidation: "NOT_APPLICABLE", acquirer: "REDE", transactionType, cardBrand: cardBrand || undefined, installments: installmentCount });
        return;
      }

      if (sheetKey === "ajustes") {
        const adjustmentDate = date(get(row, "data do ajuste", "data do lançamento")) || manualPaymentDate;
        const reason = text(get(row, "motivo", "tipo do ajuste")) || "Ajuste";
        const charged = number(get(row, "valor cobrado nesta data"));
        const credited = number(get(row, "valor creditado nesta data"));
        const isAnticipation = normalize(reason).includes("antecipacao");
        if (charged !== 0) push({ sourceSheet: sheetName, sourceRow, eventType: isAnticipation ? "ANTICIPATION" : "ADJUSTMENT", saleDate: adjustmentDate, dueDate: adjustmentDate, paymentDate: adjustmentDate, description: reason.toUpperCase(), category: isAnticipation ? categories.anticipation : categories.adjustment, amount: -Math.abs(charged), anticipated: isAnticipation, status: "OK", rateValidation: "NOT_APPLICABLE" });
        if (credited !== 0) push({ sourceSheet: sheetName, sourceRow, eventType: "ADJUSTMENT", saleDate: adjustmentDate, dueDate: adjustmentDate, paymentDate: adjustmentDate, description: `DEVOLUÇÃO - ${reason}`.toUpperCase(), category: categories.adjustment, amount: Math.abs(credited), anticipated: false, status: "OK", rateValidation: "NOT_APPLICABLE" });
        return;
      }

      if (sheetKey === "cancelamentos e contestacoes") {
        const kind = normalize(get(row, "cancelamento/chargeback"));
        const eventType: AcquirerEventType = kind.includes("chargeback") || kind.includes("contest") ? "CHARGEBACK" : "CANCELLATION";
        const value = number(get(row, "valor descontado", "valor original da venda"));
        const eventDate = date(get(row, "data do débito", "data original da venda")) || manualPaymentDate;
        if (value !== 0) push({ sourceSheet: sheetName, sourceRow, eventType, saleDate: date(get(row, "data original da venda")), dueDate: eventDate, paymentDate: eventDate, description: text(get(row, "motivo do cancelamento")) || eventType, category: eventType === "CHARGEBACK" ? categories.chargeback : categories.cancellation, amount: -Math.abs(value), anticipated: false, status: "OK", rateValidation: "NOT_APPLICABLE" });
        return;
      }

      if (sheetKey === "recebidos") {
        const depositedValue = number(get(row, "valor depositado"));
        const eventDate = date(get(row, "data")) || manualPaymentDate;
        const receivedBrand = get(row, "bandeira", "bandeira do recebimento") ?? brand;
        const receivedModality = get(row, "modalidade", "modalidade do recebimento") ?? modality;
        const receivedEstablishment = text(get(row, "nome do estabelecimento", "estabelecimento")) || establishment;
        const baseKey = aggregateBaseKey(eventDate, receivedBrand, receivedModality, receivedEstablishment);
        const aggregate = findBestPaymentAggregate(paymentAggregates, baseKey, depositedValue);

        const finalType = aggregate?.modality ?? normalizeModality(receivedModality);
        const finalBrand = aggregate?.brand || (finalType === "PIX" ? "" : displayBrand(receivedBrand));
        const finalInstallments = aggregate?.installments ?? 1;
        const chargedRate = aggregate?.chargedRate || 0;
        const grossAmount = aggregate?.gross || depositedValue;
        const validation = aggregate
          ? validateRate(chargedRate, finalType, finalInstallments, finalBrand, contractedRates)
          : chargedRate > 0
            ? { rateValidation: "NOT_CONFIGURED" as const }
            : { rateValidation: "NOT_APPLICABLE" as const };
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
          amount: grossAmount,
          anticipated: !normalize(get(row, "negociadas")).includes("livre"),
          status: validation.rateValidation === "DIVERGENT" ? "REVIEW" : "OK",
          rateValidation: validation.rateValidation,
          chargedRate: chargedRate || undefined,
          contractedRate: "contractedRate" in validation ? validation.contractedRate : undefined,
          acquirer: "REDE",
          transactionType: finalType,
          cardBrand: finalBrand || undefined,
          installments: finalInstallments,
        });
        return;
      }

      if (sheetKey === "bloqueados retido e penhorado") {
        const value = number(get(row, "valor do bloqueio"));
        const eventDate = date(get(row, "data do bloqueio")) || manualPaymentDate;
        if (value !== 0) push({ sourceSheet: sheetName, sourceRow, eventType: "ADJUSTMENT", saleDate: eventDate, dueDate: eventDate, paymentDate: eventDate, description: `BLOQUEIO - ${text(get(row, "tipo do bloqueio"))}`.trim(), category: categories.adjustment, amount: -Math.abs(value), anticipated: false, status: "REVIEW", rateValidation: "NOT_APPLICABLE" });
        return;
      }

      if (sheetKey === "desagendamentos de cessao") {
        const current = number(get(row, "valor desagendado neste pagamento"));
        const future = number(get(row, "valor desagendamento no pagamento futuro"));
        const eventDate = date(get(row, "data do recebimento desagendado", "data prevista para desagendamento")) || manualPaymentDate;
        for (const [label, value] of [["DESAGENDAMENTO", current], ["DESAGENDAMENTO FUTURO", future]] as const) {
          if (value !== 0) push({ sourceSheet: sheetName, sourceRow, eventType: "ADJUSTMENT", saleDate: date(get(row, "data original da venda")), dueDate: eventDate, paymentDate: eventDate, description: label, category: categories.adjustment, amount: -Math.abs(value), anticipated: false, status: "REVIEW", rateValidation: "NOT_APPLICABLE" });
        }
        return;
      }

      if (sheetKey === "cobrancas em aberto") {
        const value = number(get(row, "valor pendente", "total da cobrança"));
        const eventDate = date(get(row, "data de criação do débito")) || manualPaymentDate;
        if (value !== 0) push({ sourceSheet: sheetName, sourceRow, eventType: "ADJUSTMENT", saleDate: eventDate, dueDate: eventDate, paymentDate: eventDate, description: text(get(row, "motivo")) || "COBRANÇA EM ABERTO", category: categories.adjustment, amount: -Math.abs(value), anticipated: false, status: "REVIEW", rateValidation: "NOT_APPLICABLE" });
      }
    });
  }

  return { lines, processedSheets, sourceRows };
}
