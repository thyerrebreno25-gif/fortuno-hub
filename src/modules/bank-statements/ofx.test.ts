import { describe, expect, it } from "vitest";
import { generateOfx } from "./ofx";

describe("gerador OFX de extratos", () => {
  it("gera Money 102 compatível, usa a data contábil e mantém o sinal correto", () => {
    const ofx = generateOfx({
      bankId: "323",
      branch: "1",
      account: "123456789",
      initialBalance: 1_000,
      finalBalance: 1_080,
      transactions: [
        {
          id: 1,
          selected: true,
          date: "2026-07-04",
          accountingDate: "2026-07-06",
          description: "Pix recebido de CLIENTE Á",
          document: "",
          sourceType: "Entrada PIX",
          type: "CREDIT",
          amount: 100,
          balance: null,
          status: "OK",
        },
        {
          id: 2,
          selected: true,
          date: "2026-07-04",
          accountingDate: "2026-07-06",
          description: "Pix enviado para FORNECEDOR & A",
          document: "",
          sourceType: "Saída PIX",
          type: "DEBIT",
          amount: 20,
          balance: 1_080,
          status: "OK",
        },
      ],
    });

    expect(ofx).toContain("ENCODING:USASCII\r\nCHARSET:1252");
    expect(ofx).toContain("<ORG>Mercado Pago</ORG>");
    expect(ofx).toContain("<BANKID>323</BANKID>");
    expect(ofx.match(/<DTPOSTED>20260706120000\[-3:BRT\]<\/DTPOSTED>/g)).toHaveLength(2);
    expect(ofx).toContain("<TRNAMT>100.00</TRNAMT>");
    expect(ofx).toContain("<TRNAMT>-20.00</TRNAMT>");
    expect(ofx).toContain("<BALAMT>1080.00</BALAMT>");
    expect(ofx).toContain("Pix recebido de CLIENTE A");
    expect(ofx).toContain("FORNECEDOR &amp; A");
    expect(ofx).not.toContain("<AVAILCASH>");
    expect([...ofx].every((character) => character.charCodeAt(0) <= 127)).toBe(true);
  });

  it("ordena os lançamentos pela data antes da exportação", () => {
    const ofx = generateOfx({
      bankId: "104",
      initialBalance: 0,
      finalBalance: 30,
      transactions: [
        {
          id: 2,
          selected: true,
          date: "2026-07-20",
          description: "Segundo",
          document: "2",
          type: "CREDIT",
          amount: 20,
          balance: 30,
          status: "OK",
        },
        {
          id: 1,
          selected: true,
          date: "2026-07-10",
          description: "Primeiro",
          document: "1",
          type: "CREDIT",
          amount: 10,
          balance: 10,
          status: "OK",
        },
      ],
    });

    expect(ofx.indexOf("<MEMO>Primeiro</MEMO>")).toBeLessThan(
      ofx.indexOf("<MEMO>Segundo</MEMO>"),
    );
    expect(ofx).toContain("<DTSTART>20260710120000[-3:BRT]</DTSTART>");
    expect(ofx).toContain("<DTEND>20260720120000[-3:BRT]</DTEND>");
  });

  it("identifica corretamente a instituição Nubank pelo código 260", () => {
    const ofx = generateOfx({
      bankId: "260",
      branch: "0001",
      account: "794873052-0",
      initialBalance: 100,
      finalBalance: 106.49,
      transactions: [{
        id: 1,
        selected: true,
        date: "2026-10-08",
        description: "Rendimento líquido",
        document: "NU-20261008-RENDIMENTO",
        type: "CREDIT",
        amount: 6.49,
        balance: 106.49,
        status: "OK",
      }],
    });

    expect(ofx).toContain("<ORG>Nu Pagamentos S.A.</ORG>");
    expect(ofx).toContain("<BANKID>260</BANKID>");
    expect(ofx).toContain("<TRNAMT>6.49</TRNAMT>");
  });
});
