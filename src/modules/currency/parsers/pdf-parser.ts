import type { CurrencyTransaction } from "../types";
import { detectCurrency, inferTransactionType } from "../utils/detection";
import { normalizeDate } from "../utils/date";
import { parseCurrencyNumber } from "../utils/number";

async function extractPdfLines(file: File): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const document = await pdfjs.getDocument({
  data: new Uint8Array(await file.arrayBuffer()),
}).promise;

  const lines: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();

    const pageLines = new Map<number, Array<{ x: number; text: string }>>();

    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;

      const y = Math.round(item.transform[5]);
      const x = item.transform[4];
      const current = pageLines.get(y) ?? [];

      current.push({
        x,
        text: item.str.trim(),
      });

      pageLines.set(y, current);
    }

    [...pageLines.entries()]
      .sort((a, b) => b[0] - a[0])
      .forEach(([, parts]) => {
        const line = parts
          .sort((a, b) => a.x - b.x)
          .map((part) => part.text)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();

        if (line) lines.push(line);
      });
  }

  return lines;
}

const VALUE_PATTERN =
  /[+-]?\d{1,3}(?:[.\s]\d{3})*(?:,\d{2,8})|[+-]?\d+(?:\.\d{2,8})/g;

const HEADER_PATTERN =
  /^(wise payments|1st floor|london|united kingdom|extrato em|gerado em|titular da conta|número da conta|routing number|swift\/bic|descrição entrada saída valor|ref:|precisa de ajuda|a wise payments)/i;

function extractValues(line: string): Array<{ raw: string; amount: number }> {
  return [...line.matchAll(VALUE_PATTERN)]
    .map((match) => ({
      raw: match[0],
      amount: parseCurrencyNumber(match[0]),
    }))
    .filter((item) => Number.isFinite(item.amount));
}

function cleanDescription(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s*\|\s*/g, " | ")
    .trim();
}

function isWiseDocument(lines: string[]): boolean {
  const beginning = lines.slice(0, 40).join(" ");
  return /\bWise Payments\b/i.test(beginning) || /\bExtrato em [A-Z]{3}\b/i.test(beginning);
}

function parseWiseLines(
  lines: string[],
  selectedCurrency: string,
): {
  transactions: CurrencyTransaction[];
  audit: PdfParserAudit;
} {
  const documentCurrency =
    detectCurrency(lines.slice(0, 50).join(" ")) ?? selectedCurrency;

  const output: CurrencyTransaction[] = [];
  const discardedCandidates: string[] = [];

  let pendingDescription: string[] = [];
  let pendingAmount: number | null = null;
  let pendingBalance: number | null = null;
  let pendingValueLine = "";
  let candidateLines = 0;

  function resetPending() {
    pendingDescription = [];
    pendingAmount = null;
    pendingBalance = null;
    pendingValueLine = "";
  }

  function finalizeTransaction(metadataLine: string, date: string) {
    if (
      pendingAmount === null ||
      pendingDescription.length === 0 ||
      pendingAmount === 0
    ) {
      if (pendingDescription.length > 0 || pendingAmount !== null) {
        discardedCandidates.push(
          cleanDescription(
            `${pendingDescription.join(" ")} ${pendingValueLine} ${metadataLine}`,
          ),
        );
      }
      resetPending();
      return;
    }

    const description = cleanDescription(
      `${pendingDescription.join(" ")} ${metadataLine}`,
    );

    output.push({
      id: crypto.randomUUID(),
      date,
      description,
      originalAmount: Math.abs(pendingAmount),
      currency: documentCurrency,
      rate: null,
      rateDate: null,
      rateSource: null,
      convertedAmount: null,
      type: inferTransactionType(description, pendingAmount),
      status: "PENDING",
    });

    resetPending();
  }

  for (const rawLine of lines) {
    const line = cleanDescription(rawLine);
    if (!line || HEADER_PATTERN.test(line)) continue;

    const date = normalizeDate(line);
    const isMetadataLine =
      Boolean(date) && /\b(Transação|Transaction):\s*/i.test(line);

    // No layout visual da Wise, o valor normalmente aparece na linha da
    // descrição e a data/identificador vêm logo abaixo.
    if (isMetadataLine && date) {
      finalizeTransaction(line, date);
      continue;
    }

    const values = extractValues(line);
    const isClosingBalanceHeader = /\b[A-Z]{3}\s+em\s+\d{1,2}\b/i.test(line);
    const isFooter =
      /\bBaixar anexos\b/i.test(line) ||
      /^\d+\s*\/\s*\d+$/.test(line) ||
      /\bA Wise Payments Limited\b/i.test(line) ||
      /\bPrecisa de ajuda\b/i.test(line);

    if (isClosingBalanceHeader || isFooter) continue;

    // Uma linha de lançamento da Wise termina com:
    // valor da movimentação + saldo após a movimentação.
    // A descrição pode conter outros números (valor em THB, tarifa etc.),
    // portanto os DOIS ÚLTIMOS valores são os relevantes.
    if (values.length >= 2) {
      candidateLines += 1;
      pendingAmount = values[values.length - 2].amount;
      pendingBalance = values[values.length - 1].amount;
      pendingValueLine = line;

      const lastValue = values[values.length - 1].raw;
      const movementValue = values[values.length - 2].raw;
      const descriptionPart = cleanDescription(
        line
          .replace(lastValue, "")
          .replace(movementValue, ""),
      );

      if (descriptionPart) {
        pendingDescription.push(descriptionPart);
      }

      continue;
    }

    // Descrições quebradas em mais de uma linha são preservadas.
    if (!date) {
      pendingDescription.push(line);
      if (pendingDescription.length > 6) {
        pendingDescription = pendingDescription.slice(-6);
      }
    }
  }

  if (pendingDescription.length > 0 || pendingAmount !== null) {
    discardedCandidates.push(
      cleanDescription(
        `${pendingDescription.join(" ")} ${pendingValueLine}`,
      ),
    );
  }

  return {
    transactions: output,
    audit: {
      totalLines: lines.length,
      candidateLines,
      parsedTransactions: output.length,
      discardedCandidates: discardedCandidates.filter(Boolean).slice(0, 20),
    },
  };
}

function parseGenericLines(
  lines: string[],
  selectedCurrency: string,
): CurrencyTransaction[] {
  const detectedDocumentCurrency =
    detectCurrency(lines.slice(0, 60).join(" ")) ?? selectedCurrency;

  const output: CurrencyTransaction[] = [];
  let currentDate: string | null = null;
  let previousDescription = "";
  const fallbackYear = new Date().getFullYear();

  for (const line of lines) {
    const lineDate = normalizeDate(line, fallbackYear);

    if (lineDate) currentDate = lineDate;

    const matches = extractValues(line);
    if (!currentDate || matches.length === 0) {
      if (!lineDate && !HEADER_PATTERN.test(line)) {
        previousDescription = cleanDescription(line);
      }
      continue;
    }

    if (/\bsaldo\b/i.test(line)) continue;

    // Quando há saldo na mesma linha, o primeiro valor é a movimentação.
    const selectedValue = matches.length >= 2 ? matches[0] : matches[matches.length - 1];
    const amount = selectedValue.amount;

    if (!amount) continue;

    let description = cleanDescription(line.replace(selectedValue.raw, ""));

    if (
      description.length < 2 ||
      /^[\d\s.,+\-]+$/.test(description)
    ) {
      description = previousDescription;
    }

    if (description.length < 2) continue;

    const currency = detectedDocumentCurrency;
    const type = inferTransactionType(description, amount);

    output.push({
      id: crypto.randomUUID(),
      date: currentDate,
      description,
      originalAmount: Math.abs(amount),
      currency,
      rate: null,
      rateDate: null,
      rateSource: null,
      convertedAmount: null,
      type,
      status: "PENDING",
    });

    previousDescription = "";
  }

  return output;
}

export async function parsePdf(
  file: File,
  selectedCurrency: string,
): Promise<CurrencyTransaction[]> {
  const result = await parsePdfWithSummary(file, selectedCurrency);
  return result.transactions;
}


export type PdfParserAudit = {
  totalLines: number;
  candidateLines: number;
  parsedTransactions: number;
  discardedCandidates: string[];
};

export type PdfBalanceSummary = {
  transactions: CurrencyTransaction[];
  detectedClosingBalance: number | null;
  audit: PdfParserAudit;
};

function detectWiseClosingBalance(lines: string[]): number | null {
  for (const line of lines.slice(0, 60)) {
    const match = line.match(/\b[A-Z]{3}\s+em\s+\d{1,2}\s+(?:de\s+)?[A-Za-zÀ-ÿ]+\s+(?:de\s+)?20\d{2}[^\d+-]*([+-]?\d{1,3}(?:[.\s]\d{3})*,\d{2})\s+[A-Z]{3}\b/i);
    if (match) {
      const value = parseCurrencyNumber(match[1]);
      return Number.isFinite(value) ? value : null;
    }
  }

  return null;
}

export async function parsePdfWithSummary(
  file: File,
  selectedCurrency: string,
): Promise<PdfBalanceSummary> {
  const lines = await extractPdfLines(file);
  const wise = isWiseDocument(lines);
  const wiseResult = wise
    ? parseWiseLines(lines, selectedCurrency)
    : null;
  const genericTransactions = wiseResult
    ? []
    : parseGenericLines(lines, selectedCurrency);
  const transactions =
    wiseResult?.transactions.length
      ? wiseResult.transactions
      : parseGenericLines(lines, selectedCurrency);

  return {
    transactions,
    detectedClosingBalance: wise ? detectWiseClosingBalance(lines) : null,
    audit:
      wiseResult?.audit ?? {
        totalLines: lines.length,
        candidateLines: genericTransactions.length,
        parsedTransactions: transactions.length,
        discardedCandidates: [],
      },
  };
}
