import { describe, expect, it } from "vitest";
import { parseNfeXml } from "./nfe-parser";

describe("parseNfeXml", () => {
  it("lê itens, fornecedor e rateia o valor final sem diferença", () => {
    const xml = `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe12345678901234567890123456789012345678901234"><ide><natOp>COMPRA</natOp><serie>1</serie><nNF>123</nNF><dhEmi>2026-08-10T10:00:00-03:00</dhEmi></ide><emit><CNPJ>12345678000199</CNPJ><xNome>Fornecedor Teste</xNome></emit><det nItem="1"><prod><cProd>A1</cProd><xProd>Produto A</xProd><NCM>1000</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>2</qCom><vUnCom>30</vUnCom><vProd>60</vProd></prod></det><det nItem="2"><prod><cProd>B2</cProd><xProd>Produto B</xProd><uCom>UN</uCom><qCom>1</qCom><vUnCom>40</vUnCom><vProd>40</vProd></prod></det><total><ICMSTot><vProd>100</vProd><vFrete>10</vFrete><vNF>110</vNF></ICMSTot></total><cobr><dup><dVenc>2026-09-10</dVenc></dup></cobr></infNFe></NFe></nfeProc>`;
    const parsed = parseNfeXml(xml);
    expect(parsed.number).toBe("123");
    expect(parsed.supplierDocument).toBe("12345678000199");
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items.reduce((sum, item) => sum + item.allocationAmount, 0)).toBe(110);
    expect(parsed.items[0].allocationAmount).toBe(66);
    expect(parsed.installments).toEqual([expect.objectContaining({
      installmentNumber: 1,
      dueDate: new Date("2026-09-10T12:00:00.000Z"),
      amount: 110,
      source: "MANUAL_REQUIRED",
    })]);
  });

  it("lê todas as parcelas, seus vencimentos, valores e a forma de pagamento", () => {
    const xml = `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe12345678901234567890123456789012345678901234"><ide><serie>1</serie><nNF>456</nNF><dhEmi>2026-09-03T09:00:00-03:00</dhEmi></ide><emit><CNPJ>12345678000199</CNPJ><xNome>Fornecedor Parcelado</xNome></emit><det nItem="1"><prod><cProd>A1</cProd><xProd>Compra parcelada</xProd><uCom>UN</uCom><qCom>1</qCom><vUnCom>300</vUnCom><vProd>300</vProd></prod></det><total><ICMSTot><vProd>300</vProd><vNF>300</vNF></ICMSTot></total><cobr><dup><nDup>001</nDup><dVenc>2026-10-03</dVenc><vDup>100.00</vDup></dup><dup><nDup>002</nDup><dVenc>2026-11-03</dVenc><vDup>100.00</vDup></dup><dup><nDup>003</nDup><dVenc>2026-12-03</dVenc><vDup>100.00</vDup></dup></cobr><pag><detPag><tPag>15</tPag><vPag>300.00</vPag></detPag></pag></infNFe></NFe></nfeProc>`;
    const parsed = parseNfeXml(xml);

    expect(parsed.paymentMethod).toBe("BOLETO_BANCARIO");
    expect(parsed.dueDate).toEqual(new Date("2026-10-03T12:00:00.000Z"));
    expect(parsed.installments).toEqual([
      expect.objectContaining({ installmentNumber: 1, externalNumber: "001", amount: 100, source: "XML", dueDate: new Date("2026-10-03T12:00:00.000Z") }),
      expect.objectContaining({ installmentNumber: 2, externalNumber: "002", amount: 100, source: "XML", dueDate: new Date("2026-11-03T12:00:00.000Z") }),
      expect.objectContaining({ installmentNumber: 3, externalNumber: "003", amount: 100, source: "XML", dueDate: new Date("2026-12-03T12:00:00.000Z") }),
    ]);
  });

  it("cria uma parcela para confirmação quando a NF-e não informa cobrança", () => {
    const xml = `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe12345678901234567890123456789012345678901234"><ide><nNF>789</nNF><dhEmi>2026-09-03T09:00:00-03:00</dhEmi></ide><emit><xNome>Fornecedor sem cobrança</xNome></emit><det nItem="1"><prod><xProd>Compra à vista</xProd><uCom>UN</uCom><qCom>1</qCom><vUnCom>80</vUnCom><vProd>80</vProd></prod></det><total><ICMSTot><vProd>80</vProd><vNF>80</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`;
    const parsed = parseNfeXml(xml);

    expect(parsed.installments).toEqual([expect.objectContaining({
      dueDate: parsed.issueDate,
      amount: 80,
      source: "MANUAL_REQUIRED",
    })]);
  });
});
