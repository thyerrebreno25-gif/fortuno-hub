"use client";

import type { PdfTextLine } from "./pdf-reader.client";
import {
  parseInvoiceImagePages,
  type InvoiceImagePage,
  type InvoiceImageTextLine,
} from "./image-transactions";
import type { ParsedInvoice } from "./types";

export const CARD_INVOICE_IMAGE_ACCEPT =
  ".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp";

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];

type PositionedText = InvoiceImageTextLine;

type Crop = {
  left: number;
  top: number;
  width: number;
  height: number;
  scale: number;
  enhance?: boolean;
};

type OcrWorker = Awaited<
  ReturnType<(typeof import("tesseract.js"))["createWorker"]>
>;

export function isCardInvoiceImage(file: File) {
  const name = file.name.toLowerCase();
  return file.type.startsWith("image/") || IMAGE_EXTENSIONS.some((extension) => name.endsWith(extension));
}

function cleanText(value: string) {
  return String(value ?? "")
    .replace(/[|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMoneyOcr(value: string) {
  const normalized = cleanText(value)
    .replace(/[—–−]/g, "-")
    .replace(/R\$\s*[Ss](?=\d)/gi, "R$ ")
    .replace(/R\$\s*[Oo](?=\d)/gi, "R$ 0");
  return normalized.match(/[+-]?\s*R\$\s*[\d.]+,\d{2}\b/i)?.[0] ?? normalized;
}

function cleanDescriptionOcr(value: string) {
  return cleanText(value)
    .replace(/^[^a-z0-9]*(?:[a-z%)]{1,3}\s*)?[—–-]\s*/i, "")
    .replace(/^IOF\s*INTERNACIONAL$/i, "IOF INTERNACIONAL")
    .trim();
}

function isMoneyLine(value: string) {
  return /[+-]?\s*R\$\s*[\d.]+,\d{2}\b/i.test(normalizeMoneyOcr(value));
}

function parseMoneyOcr(value: string) {
  const normalized = normalizeMoneyOcr(value);
  const match = normalized.match(/([+-]?)\s*R\$\s*([\d.]+,\d{2})\b/i);
  if (!match) return null;
  const amount = Number(match[2].replace(/\./g, "").replace(",", "."));
  return Number.isFinite(amount) ? { amount, sign: match[1] ?? "" } : null;
}

function formatOcrMoney(value: number) {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function isDateLine(value: string) {
  return /\b\d{1,2}\s+de\s+[a-zç.]+\b/i.test(cleanText(value));
}

function isDescriptionLine(value: string) {
  const normalized = cleanDescriptionOcr(value);
  if (normalized.length < 3) return false;
  return !/^(lan[cç]amento|tipo|compra\s+[aà]\s+vista|valor|data)$/i.test(normalized)
    && !isMoneyLine(normalized)
    && !isDateLine(normalized);
}

async function loadImage(file: File) {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  image.src = url;

  try {
    await image.decode();
    return image;
  } catch {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Não foi possível abrir a imagem da fatura."));
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function cropCanvas(image: HTMLImageElement, crop: Crop) {
  const sourceLeft = Math.max(0, Math.floor(image.naturalWidth * crop.left));
  const sourceTop = Math.max(0, Math.floor(image.naturalHeight * crop.top));
  const sourceWidth = Math.max(1, Math.min(
    image.naturalWidth - sourceLeft,
    Math.ceil(image.naturalWidth * crop.width),
  ));
  const sourceHeight = Math.max(1, Math.min(
    image.naturalHeight - sourceTop,
    Math.ceil(image.naturalHeight * crop.height),
  ));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(sourceWidth * crop.scale));
  canvas.height = Math.max(1, Math.ceil(sourceHeight * crop.scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Não foi possível preparar a imagem para leitura.");

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.filter = crop.enhance === false
    ? "none"
    : "grayscale(1) contrast(1.35)";
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    image,
    sourceLeft,
    sourceTop,
    sourceWidth,
    sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  context.filter = "none";
  return canvas;
}

async function recognizePositioned(
  worker: OcrWorker,
  canvas: HTMLCanvasElement,
  pageSegmentationMode: import("tesseract.js").PSM,
): Promise<{ text: string; lines: PositionedText[] }> {
  await worker.setParameters({
    preserve_interword_spaces: "1",
    tessedit_pageseg_mode: pageSegmentationMode,
  });
  const result = await worker.recognize(
    canvas,
    { rotateAuto: true },
    { text: true, blocks: true },
  );
  const positioned = (result.data.blocks ?? []).flatMap((block) =>
    block.paragraphs.flatMap((paragraph) =>
      paragraph.lines.flatMap((line) => {
        const value = cleanText(line.text);
        return value
          ? [{
              text: value,
              x: line.bbox.x0 / canvas.width,
              y: ((line.bbox.y0 + line.bbox.y1) / 2) / canvas.height,
            }]
          : [];
      }),
    ),
  );
  canvas.width = 1;
  canvas.height = 1;
  return { text: result.data.text || "", lines: positioned };
}

function nearestLine(
  anchor: PositionedText,
  candidates: PositionedText[],
  used: Set<number>,
  maximumDistance = 0.035,
) {
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  candidates.forEach((candidate, index) => {
    if (used.has(index)) return;
    const distance = Math.abs(candidate.y - anchor.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  if (bestIndex < 0 || bestDistance > maximumDistance) return null;
  used.add(bestIndex);
  return candidates[bestIndex];
}

function yearForInvoice(header: string) {
  const explicit = header.match(/\b(20\d{2})\b/);
  if (explicit) return Number(explicit[1]);
  const now = new Date();
  const dueMonth = Number(header.match(/vencimento\s*:?\s*\d{1,2}\/([01]?\d)/i)?.[1] ?? 0);
  if (dueMonth && now.getMonth() + 1 >= 10 && dueMonth <= 3) return now.getFullYear() + 1;
  return now.getFullYear();
}

export async function extractInterInvoiceImageLines(file: File): Promise<{
  lines: PdfTextLine[];
  warnings: string[];
}> {
  if (!isCardInvoiceImage(file)) {
    throw new Error("Selecione uma imagem PNG, JPG, JPEG ou WebP.");
  }

  const image = await loadImage(file);
  if (image.naturalWidth < 350 || image.naturalHeight < 350) {
    throw new Error("A imagem está pequena demais para uma leitura segura da fatura.");
  }

  const { createWorker, PSM } = await import("tesseract.js");
  const worker = await createWorker("por");
  try {
    const header = await recognizePositioned(
      worker,
      cropCanvas(image, { left: 0, top: 0, width: 1, height: 0.13, scale: 4 }),
      PSM.SPARSE_TEXT,
    );
    const tableCrop = { top: 0.08, height: 0.89 };
    const dates = await recognizePositioned(
      worker,
      cropCanvas(image, { left: 0, width: 0.11, scale: 11, ...tableCrop }),
      PSM.SINGLE_BLOCK,
    );
    const descriptions = await recognizePositioned(
      worker,
      cropCanvas(image, { left: 0.13, width: 0.58, scale: 6, ...tableCrop }),
      PSM.SINGLE_BLOCK,
    );
    const values = await recognizePositioned(
      worker,
      cropCanvas(image, { left: 0.80, width: 0.19, scale: 10, ...tableCrop }),
      PSM.SINGLE_BLOCK,
    );

    const dateLines = dates.lines.filter((line) => isDateLine(line.text));
    const descriptionLines = descriptions.lines
      .map((line) => ({ ...line, text: cleanDescriptionOcr(line.text) }))
      .filter((line) => isDescriptionLine(line.text));
    const valueLines = values.lines
      .map((line) => ({ ...line, text: normalizeMoneyOcr(line.text) }))
      .filter((line) => isMoneyLine(line.text));
    const usedDates = new Set<number>();
    const usedDescriptions = new Set<number>();
    const year = yearForInvoice(header.text);
    const transactionLines: PdfTextLine[] = [];
    let matchedExpenseTotal = 0;

    for (const valueLine of valueLines) {
      const dateLine = nearestLine(valueLine, dateLines, usedDates);
      const descriptionLine = nearestLine(valueLine, descriptionLines, usedDescriptions);
      if (!dateLine || !descriptionLine) continue;
      transactionLines.push({
        page: 1,
        y: Math.round((1 - valueLine.y) * 10000),
        text: `${dateLine.text} ${year} ${descriptionLine.text} ${valueLine.text}`,
      });
      const parsedMoney = parseMoneyOcr(valueLine.text);
      if (parsedMoney && parsedMoney.sign !== "+") {
        matchedExpenseTotal += parsedMoney.amount;
      }
    }

    const headerLines = header.text
      .split(/\r?\n/)
      .map(cleanText)
      .filter(Boolean)
      .map((text, index) => ({ page: 1, y: 20000 - index, text }));
    const warnings: string[] = [];
    if (transactionLines.length < valueLines.length) {
      warnings.push(
        `${valueLines.length - transactionLines.length} linha(s) da imagem não puderam ser associadas com segurança a uma data e descrição.`,
      );
    }

    // Quando somente um valor pequeno é perdido pelo OCR, o total da própria
    // fatura permite recompô-lo sem inventar descrição ou data. A linha segue
    // para revisão com um aviso explícito ao operador.
    const headerTotals = [...header.text.matchAll(/R\$\s*([\d.]+,\d{2})/gi)]
      .map((match) => Number(match[1].replace(/\./g, "").replace(",", ".")))
      .filter(Number.isFinite);
    const invoiceTotal = headerTotals.length ? Math.max(...headerTotals) : null;
    const unusedDates = dateLines.filter((_, index) => !usedDates.has(index));
    const unusedDescriptions = descriptionLines.filter((_, index) => !usedDescriptions.has(index));
    const inferredAmount = invoiceTotal === null
      ? 0
      : Math.round((invoiceTotal - matchedExpenseTotal) * 100) / 100;
    if (
      invoiceTotal !== null &&
      unusedDates.length === 1 &&
      inferredAmount > 0 &&
      inferredAmount < invoiceTotal
    ) {
      const closestDescription = unusedDescriptions
        .map((line) => ({ line, distance: Math.abs(line.y - unusedDates[0].y) }))
        .sort((a, b) => a.distance - b.distance)[0];
      if (closestDescription && closestDescription.distance <= 0.035) {
        transactionLines.push({
          page: 1,
          y: Math.round((1 - unusedDates[0].y) * 10000),
          text: `${unusedDates[0].text} ${year} ${closestDescription.line.text} - R$ ${formatOcrMoney(inferredAmount)}`,
        });
        transactionLines.sort((a, b) => b.y - a.y);
        warnings.push(
          `Um valor de R$ ${formatOcrMoney(inferredAmount)} foi recomposto pela diferença do total da fatura. Revise essa linha antes de exportar.`,
        );
      }
    }
    if (!transactionLines.length) {
      throw new Error(
        "O OCR abriu a imagem, mas não conseguiu reconhecer as colunas de data, lançamento e valor.",
      );
    }

    return {
      lines: [
        ...headerLines,
        { page: 1, y: 15000, text: "Despesas da fatura" },
        ...transactionLines,
      ],
      warnings,
    };
  } finally {
    await worker.terminate();
  }
}

export async function extractCardInvoiceImageText(file: File) {
  if (!isCardInvoiceImage(file)) {
    throw new Error("Selecione uma imagem PNG, JPG, JPEG ou WebP.");
  }
  const image = await loadImage(file);
  if (image.naturalWidth < 350 || image.naturalHeight < 350) {
    throw new Error("A imagem está pequena demais para uma leitura segura da fatura.");
  }
  const { createWorker, PSM } = await import("tesseract.js");
  const worker = await createWorker("por");
  try {
    const scale = Math.min(4, Math.max(1, 3000 / image.naturalWidth));
    const result = await recognizePositioned(
      worker,
      cropCanvas(image, { left: 0, top: 0, width: 1, height: 1, scale }),
      PSM.SINGLE_BLOCK,
    );
    return result.text;
  } finally {
    await worker.terminate();
  }
}

export async function parseCardInvoiceImages(
  files: File[],
  bank: string,
): Promise<ParsedInvoice> {
  if (!files.length || files.some((file) => !isCardInvoiceImage(file))) {
    throw new Error("Selecione somente imagens PNG, JPG, JPEG ou WebP.");
  }

  const { createWorker, PSM } = await import("tesseract.js");
  const worker = await createWorker("por");
  const pages: InvoiceImagePage[] = [];
  const preserveLightText = bank
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .includes("CORA");

  try {
    for (const file of files) {
      const image = await loadImage(file);
      if (image.naturalWidth < 350 || image.naturalHeight < 350) {
        throw new Error(`${file.name} está pequena demais para uma leitura segura.`);
      }
      // O aplicativo Cora usa datas em cinza muito claro. A ampliação com
      // contraste que ajuda outros layouts apaga esses caracteres, portanto
      // o Cora é lido na resolução original e sem alteração de contraste.
      const scale = preserveLightText
        ? Math.min(2, Math.max(1, 700 / image.naturalWidth))
        : Math.min(3, Math.max(1, 1800 / image.naturalWidth));
      const recognized = await recognizePositioned(
        worker,
        cropCanvas(image, {
          left: 0,
          top: 0,
          width: 1,
          height: 1,
          scale,
          enhance: !preserveLightText,
        }),
        PSM.SPARSE_TEXT,
      );
      pages.push({
        name: file.name,
        text: recognized.text,
        lines: recognized.lines,
      });
    }
  } finally {
    await worker.terminate();
  }

  return parseInvoiceImagePages(pages, bank);
}
