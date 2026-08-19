import * as XLSX from "xlsx";
import {
  parseCieloWorkbook,
  type CieloSourceTotals,
} from "./cielo-workbook-parser";
import type { AcquirerReadingRule } from "./reading-instructions";
import {
  isGetnetDetailedSheet,
  parseGetnetWorkbook,
} from "./getnet-workbook-parser";
import {
  parseRedeWorkbook,
  type Categories,
  type ContractedRate,
  type ParsedAcquirerLine,
  type ReadingInstructionSummary,
} from "./rede-workbook-parser";

export type SupportedAcquirer = "REDE" | "CIELO" | "GETNET";
export type AcquirerSourceTotals = CieloSourceTotals;

export type ConfiguredAcquirerRates = {
  name: string;
  rates: ContractedRate[];
};

export type AcquirerWorkbookResult = {
  lines: ParsedAcquirerLine[];
  processedSheets: string[];
  sourceRows: number;
  instructionSummary: ReadingInstructionSummary;
  sourceTotals: AcquirerSourceTotals | null;
  acquirer: SupportedAcquirer;
  parserId: string;
  parserVersion: string;
};

const normalize = (value: unknown) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .trim()
  .toLowerCase();

function detectAcquirer(workbook: XLSX.WorkBook): SupportedAcquirer | null {
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
      raw: true,
      range: 0,
    }).slice(0, 30);

    if (isGetnetDetailedSheet(sheetName, matrix)) {
      return "GETNET";
    }

    for (const values of matrix) {
      const headers = new Set(values.map(normalize));
      if ([
        "data de pagamento",
        "tipo de lancamento",
        "forma de pagamento",
        "valor bruto",
        "taxa/tarifa",
        "valor liquido",
      ].every((header) => headers.has(header))) {
        return "CIELO";
      }
    }
  }

  const redeSheets = new Set([
    "pagamentos",
    "pagamentos futuros",
    "recebidos",
    "ajustes",
    "cancelamentos e contestacoes",
  ]);
  if (workbook.SheetNames.some((sheetName) => redeSheets.has(normalize(sheetName)))) {
    return "REDE";
  }

  return null;
}

function ratesForAcquirer(
  acquirer: SupportedAcquirer,
  configuredAcquirers: ConfiguredAcquirerRates[],
) {
  const aliases = {
    REDE: ["rede", "redecard"],
    CIELO: ["cielo"],
    GETNET: ["getnet"],
  }[acquirer];
  const matched = configuredAcquirers.find((item) => {
    const name = normalize(item.name).replace(/[^a-z0-9]/g, "");
    return aliases.some((alias) => name.includes(alias.replace(/[^a-z0-9]/g, "")));
  });
  return matched?.rates ?? [];
}

export async function parseAcquirerWorkbook(
  file: File,
  categories: Categories,
  manualPaymentDate: string,
  configuredAcquirers: ConfiguredAcquirerRates[],
  options: { readingRules?: AcquirerReadingRule[] } = {},
): Promise<AcquirerWorkbookResult> {
  const workbook = XLSX.read(await file.arrayBuffer(), {
    type: "array",
    cellDates: true,
  });
  const acquirer = detectAcquirer(workbook);

  if (!acquirer) {
    throw new Error(
      "Layout de adquirente ainda não reconhecido. Atualmente o leitor identifica automaticamente arquivos da Rede, Cielo e GETNET.",
    );
  }

  const contractedRates = ratesForAcquirer(acquirer, configuredAcquirers);

  if (acquirer === "CIELO") {
    const result = await parseCieloWorkbook(
      file,
      categories,
      manualPaymentDate,
      contractedRates,
      options,
    );
    return {
      ...result,
      acquirer,
      parserId: "cielo-recebiveis-detalhado",
      parserVersion: "1.0.0",
    };
  }

  if (acquirer === "GETNET") {
    const result = await parseGetnetWorkbook(
      file,
      categories,
      manualPaymentDate,
      contractedRates,
      options,
    );
    return {
      ...result,
      acquirer,
      parserId: "getnet-recebiveis-detalhado",
      parserVersion: "1.0.0",
    };
  }

  const result = await parseRedeWorkbook(
    file,
    categories,
    manualPaymentDate,
    contractedRates,
    options,
  );
  return {
    ...result,
    sourceTotals: null,
    acquirer,
    parserId: "rede-workbook",
    parserVersion: "1.1.0",
  };
}
