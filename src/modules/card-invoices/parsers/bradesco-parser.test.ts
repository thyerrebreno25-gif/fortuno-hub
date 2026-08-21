import { describe, expect, it } from "vitest";
import type { PdfTextLine } from "../pdf-reader.client";
import { parseBradescoInvoice } from "./bradesco-parser";

function lines(values: string[]): PdfTextLine[] {
  return values.map((text, index) => ({ page: index < 23 ? 1 : 2, y: 1000 - index, text }));
}

describe("leitor de fatura do Bradesco", () => {
  it("lê o extrato empresarial, separa parcelas e ignora a página de taxas", () => {
    const source = lines([
      "Extrato",
      "Empresa: PL SERVICOS DE ENTREGA RAPIDA LTDA | CNPJ: 008.570.595/0001-22",
      "Mês: Agosto/2026",
      "Detalhe do Extrato",
      "Número do cartão: XXXX.XXXX.XXXX.1847",
      "Data de vencimento: 01/08/2026",
      "Data Histórico US$ R$",
      "04/03 MERCADOLIVRE MERC 005/010 0,00 679,00",
      "28/05 MERCADOLIVRE MERC 002/003 0,00 796,34",
      "12/06 CASA DAS BATERIAS 002/003 0,00 299,66",
      "13/06 POLAR TINTAS 002/003 0,00 201,76",
      "19/06 POLAR TINTAS 001/002 0,00 134,90",
      "22/06 CPX DISTRIBUIDORA 001/005 0,00 2.020,12",
      "23/06 MERCADOLIVRE PRO4 001/003 0,00 514,18",
      "01/07 MercadoCar 001/003 0,00 399,94",
      "03/07 EC MATRONCOM 001/002 0,00 233,82",
      "06/07 KAIZEN CASA DE AUTOPEC 0,00 204,10",
      "07/07 EC PRO4CEINT 001/003 0,00 44,43",
      "07/07 EC PRO4CEINT 001/003 0,00 488,46",
      "13/07 KARECAR AUTO TECH 0,00 350,00",
      "21/07 ANUIDADE 07/12 0,00 16,83",
      "23/10 EC PICHAU 009/012 0,00 1.098,47",
      "Total: 0,00 7.482,01",
      "Pagamento de Contas 1,99% 60,10% 55,72% 2,99%",
      "Parcelamento de Fatura 13,30% 347,46% 388,24% 16,30%",
      "01/08/2026.",
    ]);

    const result = parseBradescoInvoice(source);

    expect(result.bank).toBe("BRADESCO");
    expect(result.dueDate).toBe("2026-08-01");
    expect(result.invoiceTotal).toBe(7482.01);
    expect(result.items).toHaveLength(15);
    expect(result.items.reduce((total, item) => total + item.amount, 0)).toBeCloseTo(7482.01, 2);
    expect(result.items[0]).toMatchObject({
      date: "2026-03-04",
      description: "MERCADOLIVRE MERC",
      installment: "5/10",
      cardLastDigits: "1847",
    });
    expect(result.items.at(-1)).toMatchObject({
      date: "2025-10-23",
      description: "EC PICHAU",
      installment: "9/12",
    });
    expect(result.warnings).toEqual([]);
  });
});
