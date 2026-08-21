import * as XLSX from "xlsx";

export type ContaAzulAcquirerLine = {
  sourceSheet: string;
  sourceRow: number;
  eventType: "SALE" | "FEE" | "ADJUSTMENT" | "CANCELLATION" | "CHARGEBACK" | "ANTICIPATION";
  saleDate: string;
  dueDate: string;
  paymentDate: string;
  description: string;
  category: string;
  amount: number;
  acquirer?: string;
  transactionType?: "DEBIT" | "CREDIT" | "PIX" | "VOUCHER" | "OTHER";
  cardBrand?: string;
  installments?: number;
  chargedRate?: number;
  contractedRate?: number;
  rateValidation?: "MATCH" | "DIVERGENT" | "NOT_CONFIGURED" | "NOT_APPLICABLE";
  sourceMetadata?: Record<string, string | number | boolean | null>;
};

function dateForContaAzul(value: string): string {
  if (!value) return "";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function eventLabel(eventType: ContaAzulAcquirerLine["eventType"]): string {
  return {
    SALE: "Venda bruta",
    FEE: "Taxa MDR",
    ADJUSTMENT: "Ajuste",
    CANCELLATION: "Cancelamento",
    CHARGEBACK: "Chargeback",
    ANTICIPATION: "Antecipação",
  }[eventType];
}

function modalityLabel(value?: ContaAzulAcquirerLine["transactionType"]): string {
  if (!value) return "";
  return {
    DEBIT: "Débito",
    CREDIT: "Crédito",
    PIX: "PIX",
    VOUCHER: "Voucher",
    OTHER: "Outro",
  }[value];
}

function rateStatusLabel(value?: ContaAzulAcquirerLine["rateValidation"]): string {
  return {
    MATCH: "Taxa OK",
    DIVERGENT: "Taxa divergente",
    NOT_CONFIGURED: "Sem taxa contratada cadastrada",
    NOT_APPLICABLE: "Validação não aplicável",
  }[value ?? "NOT_APPLICABLE"];
}

function buildObservation(line: ContaAzulAcquirerLine): string {
  const source = line.sourceMetadata ?? {};
  const sourceValue = (...keys: string[]) => {
    for (const key of keys) {
      const value = source[key];
      if (value !== undefined && value !== null && value !== "" && value !== "-") {
        return String(value);
      }
    }
    return "";
  };
  const sourceIdentifiers = [
    sourceValue("nsu/cv") ? `NSU/CV: ${sourceValue("nsu/cv")}` : "",
    sourceValue("tid") ? `TID: ${sourceValue("tid")}` : "",
    sourceValue("numero da autorizacao")
      ? `Autorização: ${sourceValue("numero da autorizacao")}`
      : "",
    sourceValue("numero do pedido")
      ? `Pedido: ${sourceValue("numero do pedido")}`
      : "",
    sourceValue(
      "resumo de vendas/numero do lote",
      "resumo de vendas/numero do lote da venda",
      "resumo de vendas/numero do lote ajustado",
    )
      ? `Lote: ${sourceValue(
        "resumo de vendas/numero do lote",
        "resumo de vendas/numero do lote da venda",
        "resumo de vendas/numero do lote ajustado",
      )}`
      : "",
  ];
  const details = [
    `Origem: ${line.sourceSheet} - linha ${line.sourceRow}`,
    line.acquirer ? `Adquirente: ${line.acquirer}` : "",
    modalityLabel(line.transactionType) ? `Modalidade: ${modalityLabel(line.transactionType)}` : "",
    line.cardBrand ? `Bandeira: ${line.cardBrand}` : "",
    line.installments ? `Parcelas: ${line.installments}x` : "",
    line.eventType === "SALE" && line.chargedRate != null
      ? `Taxa cobrada: ${line.chargedRate.toFixed(4).replace(".", ",")}%`
      : "",
    line.eventType === "SALE" && line.contractedRate != null
      ? `Taxa contratada: ${line.contractedRate.toFixed(4).replace(".", ",")}%`
      : "",
    line.eventType === "SALE" ? rateStatusLabel(line.rateValidation) : "",
    ...sourceIdentifiers,
  ].filter(Boolean);

  return details.join(" | ");
}

function simplifiedDescription(line: ContaAzulAcquirerLine): string {
  const modality = modalityLabel(line.transactionType);
  const brand = line.cardBrand || (line.transactionType === "PIX" ? "PIX" : "");
  const detail = [brand, modality].filter(Boolean).join(" ");

  return {
    SALE: `Venda ${detail}`.trim(),
    FEE: `Taxa MDR ${detail}`.trim(),
    ADJUSTMENT: "Ajuste financeiro",
    CANCELLATION: "Cancelamento de venda",
    CHARGEBACK: "Chargeback",
    ANTICIPATION: "Taxa de antecipação",
  }[line.eventType];
}

function sanitizeFileName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "_")
    .replace(/^_+|_+$/g, "") || "cliente";
}

export function exportAcquirerToContaAzul(
  lines: ContaAzulAcquirerLine[],
  clientName: string,
  acquirerName = "ADQUIRENTE",
): void {
  if (!lines.length) {
    throw new Error("Não existem lançamentos para exportar.");
  }

  const rows = lines.map((line) => ({
    "Data de Competência": dateForContaAzul(line.saleDate || line.paymentDate),
    "Data de Vencimento": dateForContaAzul(line.dueDate || line.paymentDate),
    "Data de Pagamento": dateForContaAzul(line.paymentDate),
    Valor: Number(line.amount.toFixed(2)),
    Categoria: line.category,
    Descrição: simplifiedDescription(line),
    "Cliente/Fornecedor": "",
    "CNPJ/CPF Cliente/Fornecedor": "",
    "Centro de Custo": "",
    Observações: `${eventLabel(line.eventType)} | ${buildObservation(line)}`,
  }));

  const headers = [
    "Data de Competência",
    "Data de Vencimento",
    "Data de Pagamento",
    "Valor",
    "Categoria",
    "Descrição",
    "Cliente/Fornecedor",
    "CNPJ/CPF Cliente/Fornecedor",
    "Centro de Custo",
    "Observações",
  ];

  const worksheet = XLSX.utils.json_to_sheet(rows, { header: headers });
  worksheet["!cols"] = [
    { wch: 20 },
    { wch: 20 },
    { wch: 20 },
    { wch: 15 },
    { wch: 30 },
    { wch: 55 },
    { wch: 30 },
    { wch: 28 },
    { wch: 24 },
    { wch: 95 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Conta Azul");

  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(
    workbook,
    `Conta_Azul_${sanitizeFileName(acquirerName)}_${sanitizeFileName(clientName)}_${today}.xlsx`,
    { compression: true },
  );
}
