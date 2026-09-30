import { jsPDF } from "jspdf";
import autoTable, { type CellInput, type RowInput } from "jspdf-autotable";
import type {
  SalesReconciliationResult,
  SalesReconciliationRow,
  SalesReconciliationStatus,
} from "./types";

const STATUS_META: Record<SalesReconciliationStatus, { label: string; color: [number, number, number] }> = {
  OK: { label: "Conferido", color: [31, 145, 85] },
  WRONG_CATEGORY: { label: "Categoria incorreta", color: [221, 126, 20] },
  NOT_FOUND: { label: "Não encontrado", color: [214, 61, 69] },
  NEARBY_DATE: { label: "Data próxima", color: [187, 131, 12] },
  AMBIGUOUS: { label: "Duplicidade", color: [113, 72, 181] },
  UNMAPPED_DESTINATION: { label: "Cadastro não vinculado", color: [91, 105, 123] },
  NEGATIVE_REVIEW: { label: "Estorno/ajuste", color: [36, 116, 166] },
};

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function date(value: string | null | undefined) {
  if (!value) return "-";
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function statusCell(row: SalesReconciliationRow): CellInput {
  const meta = STATUS_META[row.status];
  return {
    content: meta.label,
    styles: { textColor: meta.color, fontStyle: "bold" },
  };
}

function drawHeader(doc: jsPDF, periodStart: string, periodEnd: string, compact = false) {
  const width = doc.internal.pageSize.getWidth();
  doc.setFillColor(15, 56, 101);
  doc.rect(0, 0, width, compact ? 14 : 17, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(compact ? 10 : 13);
  doc.text("Fortuno Hub - Divergências da conferência de vendas", 10, compact ? 9.5 : 11);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(`${date(periodStart)} a ${date(periodEnd)}`, width - 10, compact ? 9.5 : 11, { align: "right" });
}

function drawSummary(doc: jsPDF, result: SalesReconciliationResult) {
  const divergences = result.rows.filter((row) => row.status !== "OK");
  const items = [
    ["Divergências", divergences.length],
    ["Não encontrados", result.summary.notFound],
    ["Categorias", result.summary.wrongCategory],
    ["Somente no Conta Azul", result.summary.extraContaAzul],
  ] as const;
  const startX = 10;
  const gap = 4;
  const width = (doc.internal.pageSize.getWidth() - 20 - gap * 3) / 4;
  items.forEach(([label, value], index) => {
    const x = startX + index * (width + gap);
    doc.setFillColor(245, 248, 252);
    doc.setDrawColor(218, 226, 237);
    doc.roundedRect(x, 21, width, 18, 2, 2, "FD");
    doc.setTextColor(100, 116, 139);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text(label, x + 4, 27);
    doc.setTextColor(15, 35, 62);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(String(value), x + 4, 35);
  });
}

export function createSalesReconciliationPdf(
  result: SalesReconciliationResult,
  periodStart: string,
  periodEnd: string,
) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const divergences = result.rows.filter((row) => row.status !== "OK");
  drawHeader(doc, periodStart, periodEnd);
  drawSummary(doc, result);

  doc.setTextColor(15, 35, 62);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Itens que precisam de conferência", 10, 47);

  const body: RowInput[] = divergences.length
    ? divergences.map((row) => [
        statusCell(row),
        `${date(row.paymentDate)}\nLinha ${row.sourceRow}`,
        `${row.customer || "Sem cliente"}\n${row.product || "Sem produto"}`,
        row.destinationLabel || "-",
        money(row.amount),
        row.expectedCategory || "Não configurada",
        row.contaAzul
          ? `${row.contaAzul.description}\n${row.contaAzul.counterparty || "Sem contato"}\n${money(row.contaAzul.amount)}`
          : "Não localizado",
        row.contaAzul?.categoryNames.join(" / ") || "-",
      ])
    : [[{
        content: "Nenhuma divergência encontrada no período.",
        colSpan: 8,
        styles: { halign: "center", textColor: [31, 145, 85], fontStyle: "bold" },
      }]];

  autoTable(doc, {
    startY: 51,
    margin: { top: 19, right: 8, bottom: 14, left: 8 },
    tableWidth: 275,
    head: [["Divergência", "DATA PG", "Cliente / produto", "Destino", "Valor", "Categoria esperada", "Conta Azul", "Categoria no CA"]],
    body,
    theme: "grid",
    rowPageBreak: "avoid",
    styles: { font: "helvetica", fontSize: 6.6, cellPadding: 1.8, lineColor: [222, 229, 238], lineWidth: 0.15, valign: "top" },
    headStyles: { fillColor: [32, 113, 190], textColor: 255, fontStyle: "bold", fontSize: 6.7 },
    alternateRowStyles: { fillColor: [249, 251, 254] },
    columnStyles: {
      0: { cellWidth: 41 },
      1: { cellWidth: 19 },
      2: { cellWidth: 42 },
      3: { cellWidth: 29 },
      4: { cellWidth: 21, halign: "right" },
      5: { cellWidth: 37 },
      6: { cellWidth: 49 },
      7: { cellWidth: 37 },
    },
    didDrawPage: (data) => {
      if (data.pageNumber > 1) drawHeader(doc, periodStart, periodEnd, true);
    },
  });

  if (result.extraContaAzul.length) {
    doc.addPage("a4", "landscape");
    drawHeader(doc, periodStart, periodEnd, true);
    doc.setTextColor(15, 35, 62);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Receitas encontradas somente no Conta Azul", 10, 22);
    autoTable(doc, {
      startY: 26,
      margin: { top: 19, right: 10, bottom: 14, left: 10 },
      tableWidth: 274,
      head: [["Cadastro", "Datas", "Descrição / contato", "Categoria", "Valor", "Status"]],
      body: result.extraContaAzul.map((item) => [
        item.clientName,
        `Pagamento: ${date(item.paymentDate)}\nCompetência: ${date(item.competenceDate)}\nVencimento: ${date(item.dueDate)}`,
        `${item.description}\n${item.counterparty || "Sem contato"}`,
        item.categoryNames.join(" / ") || "-",
        money(item.amount),
        item.status,
      ]),
      theme: "grid",
      rowPageBreak: "avoid",
      styles: { font: "helvetica", fontSize: 7, cellPadding: 2, lineColor: [222, 229, 238], lineWidth: 0.15, valign: "top" },
      headStyles: { fillColor: [32, 113, 190], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [249, 251, 254] },
      columnStyles: {
        0: { cellWidth: 40 },
        1: { cellWidth: 42 },
        2: { cellWidth: 72 },
        3: { cellWidth: 58 },
        4: { cellWidth: 27, halign: "right" },
        5: { cellWidth: 35 },
      },
      didDrawPage: () => drawHeader(doc, periodStart, periodEnd, true),
    });
  }

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    const width = doc.internal.pageSize.getWidth();
    const height = doc.internal.pageSize.getHeight();
    doc.setDrawColor(220, 227, 236);
    doc.line(8, height - 10, width - 8, height - 10);
    doc.setTextColor(112, 127, 145);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text(`Gerado pelo Fortuno Hub em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date())}`, 8, height - 5.5);
    doc.text(`Página ${page} de ${pages}`, width - 8, height - 5.5, { align: "right" });
  }

  return doc;
}

export function downloadSalesReconciliationPdf(
  result: SalesReconciliationResult,
  periodStart: string,
  periodEnd: string,
) {
  createSalesReconciliationPdf(result, periodStart, periodEnd)
    .save(`divergencias_vendas_${periodStart}_${periodEnd}.pdf`);
}
