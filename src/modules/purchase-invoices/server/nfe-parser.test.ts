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
  });
});
