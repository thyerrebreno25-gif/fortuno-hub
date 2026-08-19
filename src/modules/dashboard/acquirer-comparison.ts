export const PRIMARY_ACQUIRERS = [
  "CIELO",
  "GETNET",
  "REDE",
  "PAGARME",
] as const;

export type PrimaryAcquirer = (typeof PRIMARY_ACQUIRERS)[number];

export type AcquirerRateSource = {
  clientId: string;
  clientName: string;
  acquirerName: string;
  rates: number[];
};

export type AcquirerClientComparison = {
  clientId: string;
  clientName: string;
  averageRate: number;
  deltaFromBest: number;
  rateCount: number;
};

export type AcquirerComparison = {
  acquirer: PrimaryAcquirer;
  label: string;
  clientsCount: number;
  bestClientName: string | null;
  highestClientName: string | null;
  bestRate: number | null;
  highestRate: number | null;
  spread: number | null;
  clients: AcquirerClientComparison[];
};

const labels: Record<PrimaryAcquirer, string> = {
  CIELO: "Cielo",
  GETNET: "Getnet",
  REDE: "Rede",
  PAGARME: "Pagar.me",
};

function roundRate(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase();
}

export function identifyPrimaryAcquirer(name: string): PrimaryAcquirer | null {
  const normalized = normalize(name);
  if (normalized.includes("CIELO")) return "CIELO";
  if (normalized.includes("GETNET")) return "GETNET";
  if (normalized === "REDE" || normalized.includes("REDECARD")) return "REDE";
  if (normalized.includes("PAGARME")) return "PAGARME";
  return null;
}

export function buildAcquirerComparison(
  sources: AcquirerRateSource[],
): AcquirerComparison[] {
  const grouped = new Map<PrimaryAcquirer, AcquirerClientComparison[]>();

  for (const source of sources) {
    const acquirer = identifyPrimaryAcquirer(source.acquirerName);
    const validRates = source.rates.filter(
      (rate) => Number.isFinite(rate) && rate >= 0,
    );
    if (!acquirer || validRates.length === 0) continue;

    const averageRate = roundRate(
      validRates.reduce((sum, rate) => sum + rate, 0) / validRates.length,
    );
    const clients = grouped.get(acquirer) ?? [];
    clients.push({
      clientId: source.clientId,
      clientName: source.clientName,
      averageRate,
      deltaFromBest: 0,
      rateCount: validRates.length,
    });
    grouped.set(acquirer, clients);
  }

  return PRIMARY_ACQUIRERS.map((acquirer) => {
    const clients = (grouped.get(acquirer) ?? [])
      .sort((left, right) => left.averageRate - right.averageRate);
    const bestRate = clients[0]?.averageRate ?? null;
    const highestRate = clients.at(-1)?.averageRate ?? null;
    const comparedClients = clients.map((client) => ({
      ...client,
      deltaFromBest:
        bestRate === null ? 0 : roundRate(client.averageRate - bestRate),
    }));

    return {
      acquirer,
      label: labels[acquirer],
      clientsCount: comparedClients.length,
      bestClientName: comparedClients[0]?.clientName ?? null,
      highestClientName: comparedClients.at(-1)?.clientName ?? null,
      bestRate,
      highestRate,
      spread:
        bestRate === null || highestRate === null
          ? null
          : roundRate(highestRate - bestRate),
      clients: comparedClients,
    };
  });
}
