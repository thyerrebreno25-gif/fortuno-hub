import { describe, expect, it } from "vitest";
import { parseBrasilmedPayroll } from "./parser";

const fixture = `
Fonte: RMLabore Relação Bancaria Liquido Folha
Quantidade de Funcionarios BRASILMED --> 4 Total Geral --> R$ 21.706,86
04737-8 R$ 10.767,23
SAMUEL WALCHAN INMETRO RJ - INSTITUTO NACIONAL DE METROLOGIA MEDICO DO TRABALHO
43299-9 R$ 5.953,52
DANIELLE GONCALVES CHAIA DA CUNHA INMETRO RJ - INSTITUTO NACIONAL DE METROLOGIA TECNICO SEGURANCA DO TRABALHO
58635-1 R$ 3.543,42
FRANCISCO CARLOS FERREIRA ILA INMETRO RJ - INSTITUTO NACIONAL DE METROLOGIA ENGENHEIRO SAUDE SEGURANCA
DIRETOR PRESIDENTE 70236208 R$ 1.442,69
MATHIAS DE AGUIAR MESQUITA DIRETORIA
`;

describe("BrasilMed parser v1", () => {
  it("fecha o total geral com quatro funcionários", () => {
    const result = parseBrasilmedPayroll(fixture);
    expect(result.rows).toHaveLength(4);
    expect(result.parsedTotal).toBeCloseTo(21706.86, 2);
    expect(result.difference).toBeCloseTo(0, 2);
  });
});
