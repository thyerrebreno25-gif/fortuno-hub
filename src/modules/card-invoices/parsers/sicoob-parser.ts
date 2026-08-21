import type { ParsedInvoice, ParsedInvoiceItem } from "../types";
import {
  extractCardInvoiceImageText,
  isCardInvoiceImage,
} from "../image-reader.client";

function normalize(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMoney(value: string): number {
  const raw = String(value ?? "").trim();

  const negative =
    /^\s*-/.test(raw) ||
    /\(\s*[\d.,]+\s*\)/.test(raw);

  const cleaned = raw
    .replace(/R\$/gi, "")
    .replace(/[()+]/g, "")
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");

  const parsed = Number(cleaned);

  if (!Number.isFinite(parsed)) return 0;

  return negative ? -Math.abs(parsed) : parsed;
}

function toIsoDate(day: number, month: number, year: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(
    2,
    "0",
  )}-${String(day).padStart(2, "0")}`;
}

function parseFullDate(value: string): string | null {
  const match = String(value ?? "").match(/(\d{2})\/(\d{2})\/(\d{4})/);

  return match
    ? `${match[3]}-${match[2]}-${match[1]}`
    : null;
}

function findDueDate(text: string): string | null {
  const patterns = [
    /VENCIMENTO\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i,
    /VENCIMENTO[\s\S]{0,100}?(\d{2}\/\d{2}\/\d{4})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match) {
      return parseFullDate(match[1]);
    }
  }

  return null;
}

function findInvoiceTotal(text: string): number | null {
  const patterns = [
    /TOTAL\s+DA\s+FATURA[\s:R$]*([\d.]+,\d{2})/i,
    /SALDO\s+TOTAL[\s:R$]*([\d.]+,\d{2})/i,
    /DEMONSTRATIVO\s+DE\s+PAGAMENTO[\s\S]{0,100}?TOTAL\s+DA\s+FATURA[\s:R$]*([\d.]+,\d{2})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match) {
      return parseMoney(match[1]);
    }
  }

  /*
   * Fallback específico do layout aprendido:
   * a página 2 possui "Saldo total 3.990,45".
   */
  const saldoTotal = text.match(/SALDO\s+TOTAL\s+([\d.]+,\d{2})/i);

  return saldoTotal ? parseMoney(saldoTotal[1]) : null;
}

function resolveYear(month: number, dueDate: string | null): number {
  if (!dueDate) return new Date().getFullYear();

  const dueYear = Number(dueDate.slice(0, 4));
  const dueMonth = Number(dueDate.slice(5, 7));

  // Fatura do começo do ano com compra de novembro/dezembro.
  return month > dueMonth + 6 ? dueYear - 1 : dueYear;
}

function installmentFrom(description: string): string | undefined {
  const matches = [
    ...description.matchAll(/\b(\d{1,2})\s*\/\s*(\d{1,2})\b/g),
  ];

  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const current = Number(matches[i][1]);
    const total = Number(matches[i][2]);

    if (
      current >= 1 &&
      total >= 2 &&
      current <= total &&
      total <= 99
    ) {
      return `${current}/${total}`;
    }
  }

  return undefined;
}

function cleanDescription(value: string): string {
  return normalize(value)
    .replace(/^[\-–—:]+/, "")
    .replace(/[\-–—:]+$/, "")
    .trim();
}

function shouldIgnore(description: string): boolean {
  const value = normalize(description).toUpperCase();

  return (
    value.startsWith("SALDO ANTERIOR") ||
    value.startsWith("TOTAL") ||
    value.startsWith("PAGAMENTO MINIMO") ||
    value.startsWith("LIMITE") ||
    value.startsWith("ROTATIVO") ||
    value.startsWith("SAQUE") ||
    value.startsWith("CREDITO") ||
    value.startsWith("DEBITOS") ||
    value.startsWith("ENCARGOS") ||
    value.startsWith("MULTA") ||
    value.startsWith("MORA") ||
    value.includes("TAXA") ||
    value.includes("CET")
  );
}

function isInvoicePayment(description: string): boolean {
  const value = normalize(description).toUpperCase();

  return (
    value.includes("PAGAMENTO DEBITO EM CONTA") ||
    value.includes("PAGAMENTO DA FATURA") ||
    /^PAGAMENTO\b/.test(value)
  );
}

function parseMovementLine(
  line: string,
  dueDate: string | null,
  id: number,
): ParsedInvoiceItem | null {
  const cleaned = normalize(line);

  /*
   * Formato real observado no PDF Sicoob:
   *
   * 01/07 PCPAY*JOAO EDUARDO 12/12 S Paulo 76,31
   * 17/03 MERCADOLIVRE*6PRODUT 04/04 CAPIVARI 36,33
   * 24/04 VEGETAL 03/03 BRASILIA 2.333,34
   *
   * OCR pode acrescentar ou remover espaços, por isso procuramos:
   * data no início + último valor monetário da linha.
   */
  const dateMatch = cleaned.match(/^(\d{1,2})\/(\d{1,2})\b/);

  if (!dateMatch) return null;

  const moneyMatches = [
    ...cleaned.matchAll(
      /[+-]?\s*(?:R\$\s*)?\d{1,3}(?:\.\d{3})*,\d{2}\b/g,
    ),
  ];

  if (!moneyMatches.length) return null;

  const valueMatch = moneyMatches[moneyMatches.length - 1];

  if (valueMatch.index === undefined) return null;

  const day = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);

  const description = cleanDescription(
    cleaned.slice(dateMatch[0].length, valueMatch.index),
  );

  if (!description || shouldIgnore(description)) {
    return null;
  }

  const amount = parseMoney(valueMatch[0]);

  if (!amount) return null;

  const installment = installmentFrom(description);
  const payment = isInvoicePayment(description);

  return {
    id,
    date: toIsoDate(
      day,
      month,
      resolveYear(month, dueDate),
    ),
    description,
    amount,
    installment,
    transactionType: payment
      ? "INVOICE_PAYMENT"
      : installment
        ? "INSTALLMENT_PURCHASE"
        : "PURCHASE",
    exportable: !payment,
  };
}

function removeDuplicateItems(
  items: ParsedInvoiceItem[],
): ParsedInvoiceItem[] {
  const seen = new Set<string>();
  const result: ParsedInvoiceItem[] = [];

  for (const item of items) {
    const key = [
      item.date,
      normalize(item.description).toUpperCase(),
      item.amount.toFixed(2),
    ].join("|");

    if (seen.has(key)) continue;

    seen.add(key);

    result.push({
      ...item,
      id: result.length + 1,
    });
  }

  return result;
}

function extractItems(
  text: string,
  dueDate: string | null,
): ParsedInvoiceItem[] {
  const rawLines = text
    .split(/\r?\n/)
    .map(normalize)
    .filter(Boolean);

  const result: ParsedInvoiceItem[] = [];

  /*
   * O layout Sicoob reconhecido pelo OCR já preserva cada movimento
   * em uma linha. Não combinamos linhas vizinhas, porque isso fazia:
   *
   * 01/07 ... 76,31 + 17/03 ... 36,33
   *
   * virar um lançamento único com descrição concatenada e valor 36,33,
   * além de duplicar praticamente toda a fatura.
   */
  for (const line of rawLines) {
    /*
     * Uma linha válida de movimento deve começar por DD/MM.
     * Isso evita interpretar TOTAL, resumo, limites e linhas auxiliares.
     */
    if (!/^\d{1,2}\/\d{1,2}\b/.test(line)) {
      continue;
    }

    const item = parseMovementLine(
      line,
      dueDate,
      result.length + 1,
    );

    if (item) {
      result.push(item);
    }
  }

  return removeDuplicateItems(result);
}

async function openPdf(file: File, password?: string) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  return pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    password: password || undefined,
  }).promise;
}

async function renderPageForOcr(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof openPdf>>["getPage"]>>,
) {
  /*
   * Escala alta porque a fonte da tabela Sicoob é pequena.
   */
  const viewport = page.getViewport({ scale: 3 });

  const canvas = document.createElement("canvas");

  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);

  const context = canvas.getContext("2d", {
    willReadFrequently: true,
  });

  if (!context) {
    throw new Error(
      "Não foi possível preparar a página da fatura Sicoob para leitura.",
    );
  }

  await page.render({
    canvas,
    canvasContext: context,
    viewport,
  }).promise;

  return canvas;
}

async function recognizePage(
  image: HTMLCanvasElement,
): Promise<string> {
  const { createWorker } = await import("tesseract.js");

  /*
   * O layout contém português, números, cidades e nomes comerciais.
   * "por" melhora Vencimento/Movimentos/Proteção etc.
   */
  const worker = await createWorker("por");

  try {
    await worker.setParameters({
      preserve_interword_spaces: "1",
    });

    const result = await worker.recognize(image);

    return result.data.text || "";
  } finally {
    await worker.terminate();
  }
}

async function readSicoobByOcr(
  file: File,
  password?: string,
): Promise<string> {
  if (isCardInvoiceImage(file)) {
    return extractCardInvoiceImageText(file);
  }

  const pdf = await openPdf(file, password);
  const texts: string[] = [];

  /*
   * O layout aprendido tem 2 páginas.
   * Página 1: movimentos, vencimento e total.
   * Página 2: resumo e validação de saldo total.
   *
   * OCR das duas páginas ajuda na conferência do valor final.
   */
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const canvas = await renderPageForOcr(page);
    const text = await recognizePage(canvas);

    texts.push(text);
  }

  return texts.join("\n");
}

export async function parseSicoobInvoice(
  file: File,
  password?: string,
): Promise<ParsedInvoice> {
  const isPdf = file?.name?.toLowerCase().endsWith(".pdf") || file.type === "application/pdf";
  if (!isPdf && !isCardInvoiceImage(file)) {
    throw new Error(
      "O parser Sicoob aceita faturas em PDF, PNG, JPG, JPEG ou WebP.",
    );
  }

  const text = await readSicoobByOcr(file, password);

  if (normalize(text).length < 50) {
    throw new Error(
      "O arquivo Sicoob foi aberto, mas o OCR não conseguiu reconhecer o conteúdo.",
    );
  }

  const dueDate = findDueDate(text);
  const invoiceTotal = findInvoiceTotal(text);

  /*
   * Este PDF possui 13 despesas que formam a fatura:
   * - Proteção perda ou roubo: 3,20
   * - 12 movimentos de compras/parcelas: 3.987,25
   *
   * O pagamento da fatura anterior é identificado, mas fica exportable=false.
   */
  const parsedItems = extractItems(text, dueDate);

  const items = parsedItems.filter((item) => {
    /*
     * Saldo anterior nunca é item.
     * Pagamento anterior fica fora da tela/exportação porque não compõe
     * o total da nova fatura.
     */
    if (item.transactionType === "INVOICE_PAYMENT") {
      return false;
    }

    return true;
  });

  if (!items.length) {
    throw new Error(
      "O OCR leu a fatura Sicoob, mas não conseguiu estruturar os movimentos.",
    );
  }

  const warnings: string[] = [];

  if (!dueDate) {
    warnings.push(
      "O vencimento não foi identificado automaticamente no OCR.",
    );
  }

  if (invoiceTotal === null) {
    warnings.push(
      "O valor final da fatura não foi identificado automaticamente no OCR.",
    );
  }

  const identifiedTotal = Number(
    items
      .reduce((sum, item) => sum + Math.abs(item.amount), 0)
      .toFixed(2),
  );

  if (
    invoiceTotal !== null &&
    Math.abs(identifiedTotal - invoiceTotal) >= 0.01
  ) {
    warnings.push(
      `A soma reconhecida foi R$ ${identifiedTotal.toLocaleString(
        "pt-BR",
        {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        },
      )}, enquanto a fatura informa R$ ${invoiceTotal.toLocaleString(
        "pt-BR",
        {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        },
      )}. Revise os lançamentos reconhecidos pelo OCR.`,
    );
  }

  return {
    bank: "Sicoob",
    invoiceTotal,
    dueDate,
    items,
    warnings,
  };
}
