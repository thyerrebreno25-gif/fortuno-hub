import { parseAcquirerWorkbook } from "@/modules/acquirers/parse-acquirer-workbook";

const ACQUIRER_TERMS = /adquirente|rede\b|cielo|gett?net|pagar\.?me|ifood|alelo|vr\s*benef|pluxee|recebimento/i;
const SPREADSHEET_PATTERN = /\.(xlsx|xls)$/i;

export type AssistantUploadedFile = {
  name: string;
  size: number;
  type: string;
  openAiFileId?: string;
  analysis?: Record<string, unknown>;
  unsupportedAcquirerLayout?: boolean;
  parserError?: string;
};

function round(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export async function inspectAssistantFile(file: File, prompt: string) {
  const metadata: AssistantUploadedFile = {
    name: file.name,
    size: file.size,
    type: file.type || "application/octet-stream",
  };
  if (!SPREADSHEET_PATTERN.test(file.name) || !ACQUIRER_TERMS.test(prompt)) return metadata;

  try {
    const today = new Date().toISOString().slice(0, 10);
    const result = await parseAcquirerWorkbook(
      file,
      {
        sale: "Vendas",
        fee: "Taxas de adquirentes",
        adjustment: "Ajustes financeiros",
        cancellation: "Cancelamentos",
        chargeback: "Chargebacks",
        anticipation: "Antecipações",
      },
      today,
      [],
    );
    const byEvent = Object.fromEntries(
      ["SALE", "FEE", "ADJUSTMENT", "CANCELLATION", "CHARGEBACK", "ANTICIPATION"].map((eventType) => {
        const lines = result.lines.filter((line) => line.eventType === eventType);
        return [eventType, {
          count: lines.length,
          amount: round(lines.reduce((sum, line) => sum + line.amount, 0)),
        }];
      }),
    );
    metadata.analysis = {
      kind: "ACQUIRER_WORKBOOK",
      supported: true,
      acquirer: result.acquirer,
      parserId: result.parserId,
      parserVersion: result.parserVersion,
      processedSheets: result.processedSheets,
      sourceRows: result.sourceRows,
      importedLines: result.lines.length,
      reviewLines: result.lines.filter((line) => line.status === "REVIEW").length,
      total: round(result.lines.reduce((sum, line) => sum + line.amount, 0)),
      byEvent,
      sourceTotals: result.sourceTotals,
      excludedRows: result.instructionSummary.excludedRows,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível ler a planilha.";
    metadata.parserError = message;
    metadata.unsupportedAcquirerLayout = /layout de adquirente ainda não reconhecido/i.test(message);
    metadata.analysis = {
      kind: "ACQUIRER_WORKBOOK",
      supported: false,
      error: message,
    };
  }
  return metadata;
}

export async function uploadAssistantFileToOpenAI(file: File, apiKey: string) {
  const form = new FormData();
  form.append("purpose", "user_data");
  form.append("file", file, file.name);
  const response = await fetch("https://api.openai.com/v1/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const body = await response.json().catch(() => ({})) as { id?: string; error?: { message?: string } };
  if (!response.ok || !body.id) {
    throw new Error(body.error?.message || `Falha ao preparar ${file.name} para leitura.`);
  }
  return body.id;
}
