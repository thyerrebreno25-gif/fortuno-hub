import { NextResponse } from "next/server";

const BCB_BASE =
  "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata";

type BcbCurrency = {
  simbolo: string;
  nomeFormatado: string;
  tipoMoeda: string | null;
};

export async function GET() {
  try {
    const url = `${BCB_BASE}/Moedas?$top=1000&$format=json`;
    const response = await fetch(url, {
      next: { revalidate: 60 * 60 * 12 },
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Banco Central respondeu ${response.status}.`);
    }

    const payload = (await response.json()) as { value?: BcbCurrency[] };

    const currencies = (payload.value ?? [])
      .filter((item) => item.simbolo && item.simbolo !== "BRL")
      .map((item) => ({
        symbol: item.simbolo,
        name: item.nomeFormatado || item.simbolo,
        type: item.tipoMoeda ?? null,
      }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));

    return NextResponse.json({ currencies });
  } catch (error) {
    console.error("Erro ao carregar moedas do BCB:", error);

    return NextResponse.json(
      { error: "Não foi possível carregar as moedas do Banco Central." },
      { status: 502 },
    );
  }
}
