import crypto from "node:crypto";

export type ParsedNfeItem = {
  lineNumber: number;
  productCode: string | null;
  description: string;
  normalizedDescription: string;
  ncm: string | null;
  cfop: string | null;
  unit: string | null;
  quantity: number;
  unitValue: number;
  totalValue: number;
  allocationAmount: number;
};

export type ParsedNfe = {
  sourceKey: string;
  accessKey: string | null;
  number: string;
  series: string | null;
  supplierName: string;
  supplierDocument: string | null;
  issueDate: Date;
  dueDate: Date;
  totalProducts: number;
  totalInvoice: number;
  items: ParsedNfeItem[];
  metadata: Record<string, string | number | null>;
};

function decodeXml(value: string) {
  return value
    .replace(/^<!\[CDATA\[|\]\]>$/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}
function tag(source: string, name: string) {
  const match = source.match(new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:\\w+:)?${name}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function block(source: string, name: string) {
  return source.match(new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>[\\s\\S]*?<\\/(?:\\w+:)?${name}>`, "i"))?.[0] || "";
}

function numberValue(value: string) {
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function normalizeNfeDescription(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function parseDate(value: string) {
  const datePart = value.slice(0, 10);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(datePart)
    ? new Date(`${datePart}T12:00:00.000Z`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("A data de emissão da NF-e é inválida.");
  return date;
}

function allocateTotal(items: Omit<ParsedNfeItem, "allocationAmount">[], totalInvoice: number) {
  const base = items.reduce((sum, item) => sum + Math.max(item.totalValue, 0), 0);
  let allocated = 0;
  return items.map((item, index) => {
    const amount = index === items.length - 1
      ? money(totalInvoice - allocated)
      : money(base > 0 ? totalInvoice * (item.totalValue / base) : totalInvoice / items.length);
    allocated = money(allocated + amount);
    return { ...item, allocationAmount: amount };
  });
}

export function parseNfeXml(xml: string): ParsedNfe {
  if (!/<(?:\w+:)?infNFe\b/i.test(xml) || !/<(?:\w+:)?det\b/i.test(xml)) {
    throw new Error("O arquivo não parece ser um XML válido de NF-e de produtos.");
  }

  const infMatch = xml.match(/<(?:\w+:)?infNFe\b([^>]*)>/i);
  const accessKey = infMatch?.[1].match(/\bId=["']NFe(\d{44})["']/i)?.[1] || tag(xml, "chNFe") || null;
  const ide = block(xml, "ide");
  const emit = block(xml, "emit");
  const totals = block(xml, "ICMSTot");
  const cobr = block(xml, "cobr");
  const issueDate = parseDate(tag(ide, "dhEmi") || tag(ide, "dEmi"));
  const dueDateText = tag(cobr, "dVenc");
  const dueDate = dueDateText ? parseDate(dueDateText) : issueDate;

  const rawItems = Array.from(xml.matchAll(/<(?:\w+:)?det\b[^>]*>[\s\S]*?<\/(?:\w+:)?det>/gi));
  const itemsWithoutAllocation = rawItems.map((match, index) => {
    const product = block(match[0], "prod");
    const description = tag(product, "xProd");
    if (!description) throw new Error(`O item ${index + 1} da NF-e está sem descrição.`);
    return {
      lineNumber: index + 1,
      productCode: tag(product, "cProd") || null,
      description,
      normalizedDescription: normalizeNfeDescription(description),
      ncm: tag(product, "NCM") || null,
      cfop: tag(product, "CFOP") || null,
      unit: tag(product, "uCom") || null,
      quantity: numberValue(tag(product, "qCom")),
      unitValue: numberValue(tag(product, "vUnCom")),
      totalValue: money(numberValue(tag(product, "vProd"))),
    };
  });

  if (!itemsWithoutAllocation.length) throw new Error("Nenhum item foi encontrado na NF-e.");
  const totalProducts = money(numberValue(tag(totals, "vProd")) || itemsWithoutAllocation.reduce((sum, item) => sum + item.totalValue, 0));
  const totalInvoice = money(numberValue(tag(totals, "vNF")) || totalProducts);
  if (totalInvoice <= 0) throw new Error("O valor total da NF-e não pôde ser identificado.");

  const supplierDocument = tag(emit, "CNPJ") || tag(emit, "CPF") || null;
  const sourceKey = accessKey || crypto.createHash("sha256").update(xml).digest("hex");

  return {
    sourceKey,
    accessKey,
    number: tag(ide, "nNF") || "SEM NÚMERO",
    series: tag(ide, "serie") || null,
    supplierName: tag(emit, "xNome") || "FORNECEDOR NÃO IDENTIFICADO",
    supplierDocument,
    issueDate,
    dueDate,
    totalProducts,
    totalInvoice,
    items: allocateTotal(itemsWithoutAllocation, totalInvoice),
    metadata: {
      natureOperation: tag(ide, "natOp") || null,
      freight: money(numberValue(tag(totals, "vFrete"))),
      discount: money(numberValue(tag(totals, "vDesc"))),
      otherExpenses: money(numberValue(tag(totals, "vOutro"))),
      ipi: money(numberValue(tag(totals, "vIPI"))),
    },
  };
}
