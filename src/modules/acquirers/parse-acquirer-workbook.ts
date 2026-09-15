import * as XLSX from "xlsx";
import {
  isAleloWorkbook,
  parseAleloWorkbook,
} from "./alelo-workbook-parser";
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
  isIfoodReconciliationSheet,
  parseIfoodWorkbook,
  type IfoodPaymentBatch,
} from "./ifood-workbook-parser";
import {
  isPagarmeMovementSheet,
  parsePagarmeWorkbook,
} from "./pagarme-workbook-parser";
import {
  isPluxeePaymentsSheet,
  parsePluxeeWorkbook,
} from "./pluxee-workbook-parser";
import {
  parseRedeWorkbook,
  type Categories,
  type ContractedRate,
  type ParsedAcquirerLine,
  type ReadingInstructionSummary,
} from "./rede-workbook-parser";
import {
  isVrBenefitsWorkbook,
  parseVrBenefitsWorkbook,
} from "./vr-workbook-parser";
import {
  isTicketDetailedSheet,
  parseTicketWorkbook,
} from "./ticket-workbook-parser";

export type SupportedAcquirer =
  | "REDE"
  | "CIELO"
  | "GETNET"
  | "PAGARME"
  | "IFOOD"
  | "ALELO"
  | "VR BENEFÍCIOS"
  | "PLUXEE"
  | "TICKET";
export type AcquirerSourceTotals = CieloSourceTotals;
export type AcquirerPaymentBatch = IfoodPaymentBatch;

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
  paymentBatches?: AcquirerPaymentBatch[];
};

const normalize = (value: unknown) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .trim()
  .toLowerCase();

function detectAcquirer(workbook: XLSX.WorkBook): SupportedAcquirer | null {
  if (isAleloWorkbook(workbook)) {
    return "ALELO";
  }

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

    if (isPagarmeMovementSheet(sheetName, matrix)) {
      return "PAGARME";
    }

    if (isIfoodReconciliationSheet(matrix)) {
      return "IFOOD";
    }

    if (isPluxeePaymentsSheet(sheetName, matrix)) {
      return "PLUXEE";
    }

    if (isTicketDetailedSheet(sheetName, matrix)) {
      return "TICKET";
    }

    if (isVrBenefitsWorkbook(sheetName, matrix)) {
      return "VR BENEFÍCIOS";
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
    PAGARME: ["pagarme", "pagar.me"],
    IFOOD: ["ifood"],
    ALELO: ["alelo"],
    "VR BENEFÍCIOS": ["vr beneficios", "vrbeneficios", "vr"],
    PLUXEE: ["pluxee", "sodexo"],
    TICKET: ["ticket", "edenred"],
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
      "Layout de adquirente ainda não reconhecido. Atualmente o leitor identifica automaticamente arquivos da Rede, Cielo, GETNET, Pagar.me, iFood, Alelo, VR Benefícios, Pluxee e Ticket.",
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

  if (acquirer === "PAGARME") {
    const result = await parsePagarmeWorkbook(
      file,
      categories,
      manualPaymentDate,
      options,
    );
    return {
      ...result,
      acquirer,
      parserId: "pagarme-extrato-movimentacoes",
      parserVersion: "1.0.0",
    };
  }

  if (acquirer === "IFOOD") {
    const result = await parseIfoodWorkbook(
      file,
      categories,
      manualPaymentDate,
      options,
    );
    return {
      ...result,
      acquirer,
      parserId: "ifood-relatorio-conciliacao",
      parserVersion: "1.0.0",
    };
  }


  if (acquirer === "ALELO") {
    const result = await parseAleloWorkbook(
      file,
      categories,
      manualPaymentDate,
      contractedRates,
      options,
    );
    return {
      ...result,
      acquirer,
      parserId: "alelo-recebimentos",
      parserVersion: "1.0.0",
    };
  }

  if (acquirer === "VR BENEFÍCIOS") {
    const result = await parseVrBenefitsWorkbook(
      file,
      categories,
      manualPaymentDate,
      contractedRates,
      options,
    );
    return {
      ...result,
      acquirer,
      parserId: "vr-beneficios-guias-reembolso",
      parserVersion: "1.0.0",
    };
  }

  if (acquirer === "PLUXEE") {
    const result = await parsePluxeeWorkbook(
      file,
      categories,
      manualPaymentDate,
      contractedRates,
      options,
    );
    return {
      ...result,
      acquirer,
      parserId: "pluxee-extrato-pagamentos",
      parserVersion: "1.0.0",
    };
  }

  if (acquirer === "TICKET") {
    const result = await parseTicketWorkbook(
      file,
      categories,
      manualPaymentDate,
      contractedRates,
      options,
    );
    return {
      ...result,
      acquirer,
      parserId: "ticket-extrato-reembolso-detalhado",
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
    acquirer,
    parserId: "rede-workbook",
    parserVersion: "2.0.0",
  };
}
