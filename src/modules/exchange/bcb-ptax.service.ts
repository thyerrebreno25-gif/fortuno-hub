import { z } from "zod";

const responseSchema = z.object({
  value: z.array(z.object({
    cotacaoCompra: z.number(),
    cotacaoVenda: z.number(),
    dataHoraCotacao: z.string(),
  })),
});

export async function getPtax(currency: string, date: Date) {
  const base = process.env.BCB_PTAX_BASE_URL;
  if (!base) throw new Error("BCB_PTAX_BASE_URL não configurada.");

  const formatted = `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}-${date.getFullYear()}`;
  const endpoint = `${base}/CotacaoMoedaDia(moeda=@moeda,dataCotacao=@dataCotacao)?@moeda='${currency}'&@dataCotacao='${formatted}'&$format=json`;
  const response = await fetch(endpoint, { next: { revalidate: 86400 } });
  if (!response.ok) throw new Error(`Banco Central respondeu ${response.status}.`);
  const parsed = responseSchema.parse(await response.json());
  return parsed.value.at(-1) ?? null;
}
