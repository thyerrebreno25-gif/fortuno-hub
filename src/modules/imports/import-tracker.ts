export type TrackImportInput = {
  clientId?: string | null;
  module: "EXCHANGE" | "BANK_STATEMENT" | "ACQUIRER" | "CREDIT_CARD_INVOICE" | "BRASILMED_RECONCILIATION";
  status: "UPLOADED" | "PROCESSING" | "REVIEW" | "VALIDATED" | "EXPORTED" | "FAILED";
  originalName: string;
  parserId?: string | null;
  parserVersion?: string | null;
  expectedTotal?: number | null;
  parsedTotal?: number | null;
  difference?: number | null;
  metadata?: Record<string, unknown>;
  transactions?: Array<{
    date: string;
    description: string;
    amount: number;
    type: "CREDIT" | "DEBIT";
    document?: string | null;
    category?: string | null;
    costCenter?: string | null;
    sourcePage?: number | null;
    metadata?: Record<string, unknown>;
  }>;
};

export async function trackImport(input: TrackImportInput) {
  const response = await fetch("/api/imports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Não foi possível salvar o processamento.");
  return result;
}
