import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const BCB_BASE =
  "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata";
const SOURCE = "BCB_PTAX";

type BcbRate = {
  cotacaoCompra: number;
  cotacaoVenda: number;
  dataHoraCotacao: string;
  tipoBoletim?: string;
};

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toDatabaseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function toBcbDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${month}-${day}-${year}`;
}

function previousDay(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

async function loadCached(currency: string, rateDate: string) {
  return prisma.exchangeRate.findUnique({
    where: {
      currency_rateDate_source: {
        currency,
        rateDate: toDatabaseDate(rateDate),
        source: SOURCE,
      },
    },
  });
}

async function fetchBcbRate(currency: string, rateDate: string) {
  const bcbDate = toBcbDate(rateDate);
  const params = new URLSearchParams({
    "@moeda": `'${currency}'`,
    "@dataCotacao": `'${bcbDate}'`,
    "$top": "100",
    "$format": "json",
  });

  const url = `${BCB_BASE}/CotacaoMoedaDia(moeda=@moeda,dataCotacao=@dataCotacao)?${params.toString()}`;
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Banco Central respondeu ${response.status}.`);
  }

  const payload = (await response.json()) as { value?: BcbRate[] };
  const rows = payload.value ?? [];

  if (rows.length === 0) return null;

  return (
    rows.find((row) => row.tipoBoletim === "Fechamento PTAX") ??
    rows[rows.length - 1]
  );
}

export async function GET(request: NextRequest) {
  const currency = (request.nextUrl.searchParams.get("currency") ?? "")
    .trim()
    .toUpperCase();
  const requestedDate = (
    request.nextUrl.searchParams.get("date") ?? ""
  ).trim();

  if (!/^[A-Z]{3}$/.test(currency)) {
    return NextResponse.json({ error: "Moeda inválida." }, { status: 400 });
  }

  if (!isIsoDate(requestedDate)) {
    return NextResponse.json(
      { error: "Data inválida. Use AAAA-MM-DD." },
      { status: 400 },
    );
  }

  try {
    // Regra: tenta a data exata e, em finais de semana/feriados,
    // procura o último dia útil anterior por até 7 dias.
    for (let offset = 0; offset <= 7; offset += 1) {
      const candidateDate = previousDay(requestedDate, offset);
      const cached = await loadCached(currency, candidateDate);

      if (cached) {
        return NextResponse.json({
          currency,
          requestedDate,
          rateDate: candidateDate,
          buyRate: Number(cached.buyRate),
          sellRate: Number(cached.sellRate),
          source: cached.source,
          usedPreviousBusinessDay: candidateDate !== requestedDate,
        });
      }

      const bcbRate = await fetchBcbRate(currency, candidateDate);
      if (!bcbRate) continue;

      const saved = await prisma.exchangeRate.upsert({
        where: {
          currency_rateDate_source: {
            currency,
            rateDate: toDatabaseDate(candidateDate),
            source: SOURCE,
          },
        },
        update: {
          buyRate: bcbRate.cotacaoCompra,
          sellRate: bcbRate.cotacaoVenda,
          payload: bcbRate,
        },
        create: {
          currency,
          rateDate: toDatabaseDate(candidateDate),
          buyRate: bcbRate.cotacaoCompra,
          sellRate: bcbRate.cotacaoVenda,
          source: SOURCE,
          payload: bcbRate,
        },
      });

      return NextResponse.json({
        currency,
        requestedDate,
        rateDate: candidateDate,
        buyRate: Number(saved.buyRate),
        sellRate: Number(saved.sellRate),
        source: saved.source,
        usedPreviousBusinessDay: candidateDate !== requestedDate,
      });
    }

    return NextResponse.json(
      {
        error:
          "Nenhuma cotação foi encontrada na data informada nem nos sete dias anteriores.",
      },
      { status: 404 },
    );
  } catch (error) {
    console.error("Erro ao consultar cotação:", error);

    return NextResponse.json(
      { error: "Não foi possível consultar a cotação do Banco Central." },
      { status: 502 },
    );
  }
}
