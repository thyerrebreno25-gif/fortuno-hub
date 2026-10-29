import { describe, expect, it } from "vitest";
import { parseContract, parseInvestment } from "./parsers";
import { monthDate, reviewIssues, reviewSchema, schedule, validDate } from "./model";

const contractLines = ["CONTRATO DE PRESTAÇÃO DE SERVIÇOS", "Site institucional e Branding", "CONTRATANTE: MHS SOLUCOES AMBIENTAIS LTDA, pessoa jurídica, inscrita no CNPJ nº 43.541.033/0001-51.", "CONTRATADA: GIM DIGITAL LTDA, inscrita no CNPJ 33.822.179/0001-11. As partes concordam.", "Entrega do site em 90 dias e Branding em 60 dias.", "A CONTRATANTE pagará o valor de R$ 18.000,00 (dezoito mil reais) em 8 parcelas de R$ 2.250,00 (dois mil duzentos e cinquenta reais), com vencimento da primeira para o dia 15/11/2026 e as demais nos dias 15 dos meses subsequentes.", "R$ 3.000,00 se referem ao Site e R$ 15.000,00 ao Branding. O pagamento será feito mediante boleto bancário.", "Brasília/DF, 19 de outubro de 2026."].map((text) => ({ text, page: 1 }));
export const sampleContract = () => parseContract(contractLines);
describe("revisão de contratos", () => {
  it("extracts optional buyer contacts only from the buyer section",()=>{
    const result=parseContract([{page:1,text:"CONTRATANTE: EMPRESA LTDA, CNPJ 43.541.033/0001-51, e-mail comprador@example.test, telefone (61) 99999-8888. CONTRATADA: PRESTADORA LTDA, CNPJ 33.822.179/0001-11, contato vendedor@example.test. As partes concordam."}]);
    expect(result.buyerEmail).toBe("comprador@example.test");expect(result.buyerPhone).toBe("61999998888");expect(result.autoCreateBuyer).toBe(true);
  });
  it("extracts parties and the installment amount without splitting Site and Branding", () => {
    const result = sampleContract();
    expect(result.buyerDocument).toBe("43541033000151"); expect(result.sellerDocument).toBe("33822179000111");
    expect(result.description).toBe("Site institucional e Branding");
    expect(result.installments).toBe(8); expect(result.amountCents).toBe(225000); expect(result.totalCents).toBe(1800000);
    expect(result.originalDate).toBe("2026-10-19"); expect(result.startMonth).toBe("2026-11-01"); expect(result.firstDueDate).toBe("2026-11-15"); expect(result.paymentMethod).toBe("BOLETO_BANCARIO");
    expect(reviewIssues(result)).toEqual([]);
  });
  it("generates exactly eight sales on the first with due dates on the fifteenth", () => {
    const dates = schedule(sampleContract()); expect(dates).toHaveLength(8);
    expect(dates[0]).toMatchObject({ saleDate: "2026-11-01", dueDate: "2026-11-15" });
    expect(dates[7]).toMatchObject({ saleDate: "2027-06-01", dueDate: "2027-06-15" });
    expect(monthDate(dates[7].saleDate, 0, "last")).toBe("2027-06-30");
  });
  it("clamps day 31 and handles leap years and annual intervals", () => {
    expect(monthDate("2028-02-01", 0, 31)).toBe("2028-02-29"); expect(monthDate("2027-02-01", 0, "last")).toBe("2027-02-28");
    const dates = schedule({ ...sampleContract(), frequency: "YEARLY", interval: 2, installments: 2 }); expect(dates[1].saleDate).toBe("2028-11-01");
  });
  it("holds unknown layouts, missing dates, and inconsistent totals for review", () => {
    expect(reviewIssues(parseContract([{ text: "Documento digitalizado sem texto", page: 1 }])).length).toBeGreaterThan(0);
    expect(reviewIssues({ ...sampleContract(), totalCents: 1 })).toContain("O valor das cobranças não confere com o total do contrato.");
    expect(validDate("2027-02-29")).toBe(false); expect(reviewSchema.safeParse({ ...sampleContract(), installments: 999 }).success).toBe(false);
  });
});
describe("rendimentos Inter", () => {
  it("sums only Valor from the exact income rows and groups applications", () => {
    const rows = ["Período de: 01/10/2026 a 28/10/2026", ...["19,36", "9,54", "9,16", "9,14"].flatMap((value) => ["CDB MAIS LIMITE DE CREDITO", "30/09/2026 Saldo até esta data R$ 1.180,05 DEFINITIVO R$ 1.180,05", `28/10/2026 Rendimento até esta data R$ ${value} ABERTURA R$ 1.189,19`, "28/10/2026 Previsão de I.R. para resgate total até esta data R$ 33,10 DEFINITIVO R$ 1.156,09"]), ...["149,86", "274,54", "202,64", "278,70", "375,14"].flatMap((value) => ["CDB DI LIQUIDEZ DIÁRIA PJ", `28/10/2026 Rendimento até esta data R$ ${value} ABERTURA R$ 39.073,07`])];
    const parsed = parseInvestment(rows.map((text) => ({ text, page: 1 })));
    expect(parsed.rows).toHaveLength(2); expect(parsed.rows.map((row) => row.amountCents)).toEqual([4720, 128088]);
    expect(parsed.rows.map((row) => row.evidence.length)).toEqual([4, 5]); expect(reviewIssues(parsed)).toEqual([]);
  });
  it("separates different income dates and rejects missing layouts", () => {
    const parsed = parseInvestment(["CDB MAIS LIMITE DE CREDITO", "27/10/2026 Rendimento até esta data R$ 1,00 ABERTURA R$ 10,00", "28/10/2026 Rendimento até esta data R$ 2,00 ABERTURA R$ 12,00"].map((text) => ({ text, page: 1 })));
    expect(parsed.rows).toHaveLength(2); expect(parsed.warnings.length).toBeGreaterThan(0); expect(reviewIssues(parseInvestment([])).length).toBeGreaterThan(0);
  });
});
