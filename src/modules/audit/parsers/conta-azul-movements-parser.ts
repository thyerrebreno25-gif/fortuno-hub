import type { AuditMovement } from "../types";

type PdfTextItem = {
  str: string;
  transform: number[];
  width?: number;
};

type Positioned = {
  x: number;
  y: number;
  text: string;
};

type Row = {
  y: number;
  items: Positioned[];
};

type ColumnStarts = {
  Data: number;
  Descrição: number;
  "Cliente/Fornecedor"?: number;
  Categoria: number;
  Situação?: number;
  Valor: number;
  Saldo?: number;
};

const DATE_RE = /\b\d{2}\/\d{2}\/\d{4}\b/;
const MONEY_RE = /-?\s*\d{1,3}(?:\.\d{3})*,\d{2}|-?\s*\d+,\d{2}/g;

function normalize(value: string) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(value: string) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMoney(value: string): number | null {
  const raw = String(value ?? "").trim();

  if (!raw) return null;

  const negative =
    /^\s*-\s*/.test(raw) ||
    /\(\s*[\d.]+,\d{2}\s*\)/.test(raw);

  const cleaned = raw
    .replace(/R\$/gi, "")
    .replace(/[()]/g, "")
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");

  if (!cleaned || cleaned === "-") return null;

  const parsed = Number(cleaned);

  if (!Number.isFinite(parsed)) return null;

  return negative && parsed > 0 ? -parsed : parsed;
}

function toIsoDate(value: string): string | null {
  const match = String(value ?? "").match(
    /(\d{2})\/(\d{2})\/(\d{4})/,
  );

  if (!match) return null;

  return `${match[3]}-${match[2]}-${match[1]}`;
}

function clusterRows(items: Positioned[]): Row[] {
  const rows: Row[] = [];

  const sorted = [...items].sort(
    (a, b) => b.y - a.y || a.x - b.x,
  );

  for (const item of sorted) {
    let bestRow: Row | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const row of rows) {
      const distance = Math.abs(row.y - item.y);

      if (distance <= 4.5 && distance < bestDistance) {
        bestRow = row;
        bestDistance = distance;
      }
    }

    if (bestRow) {
      bestRow.items.push(item);
    } else {
      rows.push({
        y: item.y,
        items: [item],
      });
    }
  }

  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => ({
      ...row,
      items: row.items.sort((a, b) => a.x - b.x),
    }));
}

function matchesHeader(text: string, target: string) {
  const value = normalize(text).toUpperCase();

  if (target === "DATA") {
    return value === "DATA";
  }

  if (target === "DESCRICAO") {
    return value.includes("DESCRICAO");
  }

  if (target === "CLIENTE_FORNECEDOR") {
    return (
      value.includes("CLIENTE/FORNECEDOR") ||
      value.includes("CLIENTE") ||
      value.includes("FORNECEDOR")
    );
  }

  if (target === "CATEGORIA") {
    return value.includes("CATEGORIA");
  }

  if (target === "SITUACAO") {
    return value.includes("SITUACAO");
  }

  if (target === "VALOR") {
    return value === "VALOR" || value.startsWith("VALOR ");
  }

  if (target === "SALDO") {
    return value === "SALDO" || value.startsWith("SALDO ");
  }

  return false;
}

/**
 * O Conta Azul pode entregar os títulos do cabeçalho com pequenas diferenças
 * de coordenada Y. Por isso não dependemos mais de todos os títulos estarem
 * dentro da mesma linha agrupada.
 */
function findColumnStartsFromPositioned(
  positioned: Positioned[],
): ColumnStarts | null {
  const dataCandidates = positioned.filter((item) =>
    matchesHeader(item.text, "DATA"),
  );

  for (const dataItem of dataCandidates) {
    const neighborhood = positioned.filter(
      (item) => Math.abs(item.y - dataItem.y) <= 14,
    );

    const description = neighborhood.find((item) =>
      matchesHeader(item.text, "DESCRICAO"),
    );
    const counterparty = neighborhood.find((item) =>
      matchesHeader(item.text, "CLIENTE_FORNECEDOR"),
    );
    const category = neighborhood.find((item) =>
      matchesHeader(item.text, "CATEGORIA"),
    );
    const situation = neighborhood.find((item) =>
      matchesHeader(item.text, "SITUACAO"),
    );
    const value = neighborhood.find((item) =>
      matchesHeader(item.text, "VALOR"),
    );
    const balance = neighborhood.find((item) =>
      matchesHeader(item.text, "SALDO"),
    );

    if (description && category && value) {
      return {
        Data: dataItem.x,
        Descrição: description.x,
        "Cliente/Fornecedor": counterparty?.x,
        Categoria: category.x,
        Situação: situation?.x,
        Valor: value.x,
        Saldo: balance?.x,
      };
    }
  }

  return null;
}

function findColumnStartsFromRows(
  rows: Row[],
): ColumnStarts | null {
  for (const row of rows) {
    const joined = normalize(
      row.items.map((item) => item.text).join(" "),
    ).toUpperCase();

    if (
      !joined.includes("DATA") ||
      !joined.includes("DESCRICAO") ||
      !joined.includes("CATEGORIA") ||
      !joined.includes("VALOR")
    ) {
      continue;
    }

    const data = row.items.find((item) =>
      matchesHeader(item.text, "DATA"),
    );
    const description = row.items.find((item) =>
      matchesHeader(item.text, "DESCRICAO"),
    );
    const counterparty = row.items.find((item) =>
      matchesHeader(item.text, "CLIENTE_FORNECEDOR"),
    );
    const category = row.items.find((item) =>
      matchesHeader(item.text, "CATEGORIA"),
    );
    const situation = row.items.find((item) =>
      matchesHeader(item.text, "SITUACAO"),
    );
    const value = row.items.find((item) =>
      matchesHeader(item.text, "VALOR"),
    );
    const balance = row.items.find((item) =>
      matchesHeader(item.text, "SALDO"),
    );

    if (data && description && category && value) {
      return {
        Data: data.x,
        Descrição: description.x,
        "Cliente/Fornecedor": counterparty?.x,
        Categoria: category.x,
        Situação: situation?.x,
        Valor: value.x,
        Saldo: balance?.x,
      };
    }
  }

  return null;
}

function findColumnStarts(
  positioned: Positioned[],
  rows: Row[],
): ColumnStarts | null {
  return (
    findColumnStartsFromPositioned(positioned) ??
    findColumnStartsFromRows(rows)
  );
}

function orderedStarts(starts: ColumnStarts) {
  return Object.entries(starts)
    .filter((entry): entry is [string, number] => entry[1] != null)
    .sort((a, b) => a[1] - b[1]);
}

function assignColumn(
  x: number,
  starts: ColumnStarts,
): keyof ColumnStarts | "Descrição" {
  const ordered = orderedStarts(starts);

  if (!ordered.length) return "Descrição";

  for (let index = 0; index < ordered.length; index += 1) {
    const [name, start] = ordered[index];
    const next = ordered[index + 1];

    if (!next) {
      return name as keyof ColumnStarts;
    }

    const midpoint = (start + next[1]) / 2;

    if (x < midpoint) {
      return name as keyof ColumnStarts;
    }
  }

  return ordered[ordered.length - 1][0] as keyof ColumnStarts;
}

function rowText(row: Row) {
  return cleanText(
    row.items.map((item) => item.text).join(" "),
  );
}

function isNoiseRow(full: string) {
  const normalized = normalize(full).toUpperCase();

  return (
    normalized.includes("RELATORIO DE EXTRATO") ||
    normalized.includes("TOTAIS DO PERIODO") ||
    normalized.includes("USUARIO:") ||
    normalized.includes("PAGINA ") ||
    normalized.includes("DESCONSIDERADOS") ||
    normalized.includes("PERDIDOS SALDO REALIZADO") ||
    normalized.startsWith("DATA DESCRICAO")
  );
}

function extractCells(
  row: Row,
  starts: ColumnStarts,
): Record<string, string> {
  const grouped: Record<string, string[]> = {};

  for (const item of row.items) {
    const column = assignColumn(item.x, starts);

    if (!grouped[column]) {
      grouped[column] = [];
    }

    grouped[column].push(item.text);
  }

  const result: Record<string, string> = {};

  for (const [column, parts] of Object.entries(grouped)) {
    result[column] = cleanText(parts.join(" "));
  }

  return result;
}

function resolveAmountAndBalance(
  cells: Record<string, string>,
  full: string,
) {
  let amount = parseMoney(cells.Valor ?? "");
  let balance = parseMoney(cells.Saldo ?? "");

  const moneyTokens = [
    ...full.matchAll(MONEY_RE),
  ].map((match) => match[0]);

  if (moneyTokens.length >= 2) {
    const lastTwo = moneyTokens.slice(-2);

    if (amount == null) {
      amount = parseMoney(lastTwo[0]);
    }

    if (balance == null) {
      balance = parseMoney(lastTwo[1]);
    }
  }

  const normalizedSituation = normalize(
    cells.Situação ?? "",
  ).toUpperCase();

  if (
    amount != null &&
    amount > 0 &&
    (
      normalizedSituation.includes("PAGO") ||
      normalizedSituation.includes("PAGA")
    )
  ) {
    const amountText =
      cells.Valor ??
      moneyTokens.slice(-2)[0] ??
      "";

    if (/^\s*-\s*/.test(amountText)) {
      amount *= -1;
    }
  }

  return {
    amount,
    balance,
  };
}

function buildMovement(
  row: Row,
  starts: ColumnStarts,
  pageNumber: number,
  movementIndex: number,
): AuditMovement | null {
  const full = rowText(row);

  if (!DATE_RE.test(full) || isNoiseRow(full)) {
    return null;
  }

  const cells = extractCells(row, starts);

  const date = toIsoDate(
    cells.Data || full.match(DATE_RE)?.[0] || "",
  );

  if (!date) return null;

  const description = cleanText(
    cells.Descrição ?? "",
  );

  if (!description) return null;

  const { amount, balance } = resolveAmountAndBalance(
    cells,
    full,
  );

  return {
    id: `${pageNumber}-${movementIndex}-${date}`,
    date,
    description,
    counterparty:
      cleanText(cells["Cliente/Fornecedor"] ?? "") || null,
    category:
      cleanText(cells.Categoria ?? "") || null,
    situation:
      cleanText(cells.Situação ?? "") || null,
    amount: amount ?? 0,
    balance,
    monthKey: date.slice(0, 7),
    sourcePage: pageNumber,
    sourceText: full,
  };
}

function movementKey(movement: AuditMovement) {
  return [
    movement.date,
    normalize(movement.description),
    normalize(movement.counterparty ?? ""),
    normalize(movement.category ?? ""),
    movement.amount.toFixed(2),
    movement.balance?.toFixed(2) ?? "",
  ].join("|");
}

export async function parseContaAzulMovements(
  file: File,
): Promise<AuditMovement[]> {
  if (!file?.name?.toLowerCase().endsWith(".pdf")) {
    throw new Error(
      "O Extrato de Movimentações deve ser importado em PDF.",
    );
  }

  const pdfjs = await import(
    "pdfjs-dist/legacy/build/pdf.mjs"
  );

  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  }).promise;

  const movements: AuditMovement[] = [];

  for (
    let pageNumber = 1;
    pageNumber <= pdf.numPages;
    pageNumber += 1
  ) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();

    const positioned: Positioned[] = [];

    for (const raw of content.items) {
      if (!("str" in raw)) continue;

      const item = raw as PdfTextItem;
      const text = item.str?.trim();

      if (!text) continue;

      /*
       * Neste layout específico do Extrato do Conta Azul, o PDF.js está
       * entregando os eixos invertidos:
       *
       * - transform[4] cresce a cada nova LINHA do relatório;
       * - transform[5] representa a posição da COLUNA.
       *
       * O parser trabalha com x = coluna e y = linha. Por isso fazemos
       * a inversão abaixo. O sinal negativo no y mantém a ordenação
       * visual de cima para baixo compatível com clusterRows().
       */
      positioned.push({
        x: Number(item.transform[5]),
        y: -Number(item.transform[4]),
        text,
      });
    }

    const rows = clusterRows(positioned);
    const starts = findColumnStarts(
      positioned,
      rows,
    );

    if (!starts) {
      console.warn(
        `[AUDITORIA V3] Cabeçalho do Extrato Conta Azul não identificado na página ${pageNumber}.`,
      );

      console.warn(
        "[AUDITORIA V3] Itens encontrados:",
        positioned.map((item) => ({
          x: Math.round(item.x),
          y: Math.round(item.y),
          text: item.text,
        })),
      );

      continue;
    }

    console.info(
      `[AUDITORIA V3] Colunas identificadas na página ${pageNumber}:`,
      starts,
    );

    for (const row of rows) {
      const movement = buildMovement(
        row,
        starts,
        pageNumber,
        movements.length + 1,
      );

      if (movement) {
        movements.push(movement);
      }
    }
  }

  const unique = new Map<string, AuditMovement>();

  for (const movement of movements) {
    const key = movementKey(movement);

    if (!unique.has(key)) {
      unique.set(key, movement);
    }
  }

  const result = [...unique.values()].sort((a, b) => {
    const byDate = a.date.localeCompare(b.date);

    if (byDate !== 0) return byDate;

    return a.sourcePage - b.sourcePage;
  });

  console.info(
    `[AUDITORIA V3] ${result.length} movimentações únicas identificadas.`,
  );

  if (!result.length) {
    throw new Error(
      "O PDF foi aberto, mas nenhum lançamento do Extrato de Movimentações foi identificado. Consulte o console para ver o diagnóstico do layout.",
    );
  }

  return result;
}