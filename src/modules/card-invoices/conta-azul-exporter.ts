import * as XLSX from "xlsx";

export type ContaAzulInvoiceItem = {
  date: string;
  description: string;
  amount: number;
  installment?: string;
  category: string | null;
};

function formatDate(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function sanitize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "_")
    .replace(/^_+|_+$/g, "") || "cliente";
}

export function exportInvoiceToContaAzul(input: {
  items: ContaAzulInvoiceItem[];
  clientName: string;
  bankName?: string;
  competenceDate: string;
  dueDate: string;
  paymentDate: string;
}): void {
  if (!input.items.length) throw new Error("Não existem lançamentos para exportar.");
  if (input.items.some((item) => !item.category)) {
    throw new Error("Existem lançamentos sem categoria.");
  }

  const rows = input.items.map((item) => ({
    "Data de Competência": formatDate(item.date || input.competenceDate),
    "Data de Vencimento": formatDate(input.dueDate),
    "Data de Pagamento": formatDate(input.paymentDate),
    Valor: Number((-Math.abs(item.amount)).toFixed(2)),
    Categoria: item.category ?? "",
    Descrição: item.installment
      ? `${item.description} ${item.installment}`.trim()
      : item.description,
    "Cliente/Fornecedor": "",
    "CNPJ/CPF Cliente/Fornecedor": "",
    "Centro de Custo": "",
    Observações: [
      input.bankName ? `Banco: ${input.bankName}` : "",
      item.installment ? `Parcela: ${item.installment}` : "",
      "Categoria aplicada pelo Fortuno Hub",
    ].filter(Boolean).join(" | "),
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
    { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 15 }, { wch: 30 },
    { wch: 55 }, { wch: 30 }, { wch: 28 }, { wch: 24 }, { wch: 70 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Conta Azul");
  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(
    workbook,
    `Conta_Azul_Fatura_${sanitize(input.bankName ?? "Cartao")}_${sanitize(input.clientName)}_${today}.xlsx`,
    { compression: true },
  );
}
