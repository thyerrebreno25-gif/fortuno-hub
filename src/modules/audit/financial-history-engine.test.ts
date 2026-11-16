import { describe, expect, it } from "vitest";
import { analyzeFinancialHistory, type ContaAzulAuditEntry } from "./financial-history-engine";

function entry(overrides: Partial<ContaAzulAuditEntry> = {}): ContaAzulAuditEntry {
  return {
    id: "entry",
    flow: "PAYABLE",
    description: "Conta de energia",
    counterparty: "NEOENERGIA",
    categories: ["Energia elétrica"],
    costCenters: [],
    dueDate: "2026-01-10",
    competenceDate: "2025-12-01",
    status: "PAGO",
    total: 500,
    paid: 500,
    outstanding: 0,
    ...overrides,
  };
}

function analyze(
  history: ContaAzulAuditEntry[],
  current: ContaAzulAuditEntry[],
  periodStart = "2026-04-01",
  periodEnd = "2026-04-30",
) {
  return analyzeFinancialHistory({
    history,
    current,
    historyStart: "2026-01-01",
    historyEnd: "2026-03-31",
    periodStart,
    periodEnd,
    today: "2026-04-20",
  });
}

describe("analyzeFinancialHistory", () => {
  it("aprende uma obrigação mensal e aponta a ausência no período atual", () => {
    const result = analyze([
      entry({ id: "jan", dueDate: "2026-01-10" }),
      entry({ id: "fev", dueDate: "2026-02-10", competenceDate: "2026-01-01" }),
      entry({ id: "mar", dueDate: "2026-03-10", competenceDate: "2026-02-01" }),
    ], []);

    expect(result.profiles).toHaveLength(1);
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleCode: "CA_MISSING_RECURRING", flow: "PAYABLE", severity: "WARNING" }),
    ]));
  });

  it("não transforma PIX, transferência ou tarifa em recorrência", () => {
    const history = ["01", "02", "03"].flatMap((month, index) => [
      entry({ id: `pix-${month}`, description: "PAGAMENTO PIX", counterparty: null, categories: [], dueDate: `2026-${month}-10`, competenceDate: `2026-${month}-01`, total: 100 + index }),
      entry({ id: `fee-${month}`, description: "TARIFA BANCARIA", counterparty: "BANCO", categories: ["Tarifas"], dueDate: `2026-${month}-11`, competenceDate: `2026-${month}-01`, total: 20 }),
    ]);

    const result = analyze(history, []);
    expect(result.profiles).toHaveLength(0);
    expect(result.findings.some((finding) => finding.ruleCode === "CA_MISSING_RECURRING")).toBe(false);
  });

  it("aprende competência do mês anterior e aponta lançamento no mês errado", () => {
    const result = analyze([
      entry({ id: "jan", dueDate: "2026-01-10" }),
      entry({ id: "fev", dueDate: "2026-02-10", competenceDate: "2026-01-01" }),
      entry({ id: "mar", dueDate: "2026-03-10", competenceDate: "2026-02-01" }),
    ], [
      entry({ id: "apr", dueDate: "2026-04-10", competenceDate: "2026-04-01" }),
    ]);

    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleCode: "CA_COMPETENCE_DIVERGENCE", competence: "2026-04-01" }),
    ]));
  });

  it("separa alertas vencidos e abertos entre pagar e receber", () => {
    const result = analyze([], [
      entry({ id: "payable-overdue", dueDate: "2026-04-10", status: "ATRASADO", paid: 0, outstanding: 500 }),
      entry({ id: "receivable-open", flow: "RECEIVABLE", description: "Mensalidade", counterparty: "CLIENTE A", categories: ["Receita de serviços"], dueDate: "2026-04-25", competenceDate: "2026-04-01", status: "EM_ABERTO", paid: 0, outstanding: 800 }),
    ]);

    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleCode: "CA_OVERDUE", flow: "PAYABLE" }),
      expect.objectContaining({ ruleCode: "CA_OPEN", flow: "RECEIVABLE" }),
    ]));
    expect(result.findings.filter(item=>item.ruleCode==="CA_OVERDUE"&&item.flow==="PAYABLE")).toHaveLength(1);
    expect(result.metrics.receivableFindings).toBe(1);
  });

  it("aprende também a quantidade mensal esperada", () => {
    const history = ["01", "02", "03"].flatMap((month) => [
      entry({ id: `${month}-a`, dueDate: `2026-${month}-10`, description: "Energia unidade A" }),
      entry({ id: `${month}-b`, dueDate: `2026-${month}-15`, description: "Energia unidade B" }),
    ]);
    const result = analyze(history, [
      entry({ id: "apr-a", dueDate: "2026-04-10", competenceDate: "2026-03-01" }),
    ]);

    const missing = result.findings.find((finding) => finding.ruleCode === "CA_MISSING_RECURRING");
    expect(result.profiles[0].expectedMonthlyCount).toBe(2);
    expect(missing?.description).toContain("apenas 1");
  });

  it("não cobra uma recorrência cuja data habitual está fora do período parcial", () => {
    const history = ["01", "02", "03"].map((month) => entry({
      id: `energy-${month}`,
      dueDate: `2026-${month}-20`,
      competenceDate: `2026-${String(Number(month) - 1).padStart(2, "0")}-01`,
    }));

    const result = analyze(history, [], "2026-04-01", "2026-04-15");

    expect(result.profiles[0].expectedDueDays).toEqual([20]);
    expect(result.findings.some((finding) => finding.ruleCode === "CA_MISSING_RECURRING")).toBe(false);
  });

  it("cobra somente as ocorrências habituais incluídas no período parcial", () => {
    const history = ["01", "02", "03"].flatMap((month) => [
      entry({ id: `${month}-early`, dueDate: `2026-${month}-10`, description: "Energia unidade A" }),
      entry({ id: `${month}-late`, dueDate: `2026-${month}-25`, description: "Energia unidade B" }),
    ]);

    const result = analyze(history, [], "2026-04-01", "2026-04-15");
    const missing = result.findings.find((finding) => finding.ruleCode === "CA_MISSING_RECURRING");

    expect(result.profiles[0].expectedDueDays).toEqual([10, 25]);
    expect(missing?.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Quantidade esperada no intervalo", value: "1" }),
    ]));
  });
});

describe("políticas financeiras da auditoria",()=>{
 const history=["01","02","03"].map(month=>entry({id:month,description:"Aluguel",counterparty:"IMOBILIARIA",dueDate:`2026-${month}-10`,competenceDate:null,categories:["Aluguel"],total:10000}));
 const input=(current:ContaAzulAuditEntry[])=>({history,current,historyStart:"2026-01-01",historyEnd:"2026-03-31",periodStart:"2026-04-01",periodEnd:"2026-04-30",today:"2026-05-01"});
 it("compara categoria mesmo sem padrão de competência no histórico",()=>{const result=analyzeFinancialHistory(input([entry({id:"apr",description:"Aluguel",counterparty:"IMOBILIARIA",dueDate:"2026-04-10",competenceDate:"2026-03-01",categories:["Imóveis"],total:15000})]));expect(result.findings.map(item=>item.ruleCode)).toEqual(expect.arrayContaining(["CA_CATEGORY_DIVERGENCE","CA_AMOUNT_VARIATION"]));});
 it("detecta aumento de 10 mil para 15 mil",()=>{const result=analyzeFinancialHistory(input([entry({id:"apr",description:"Aluguel",counterparty:"IMOBILIARIA",dueDate:"2026-04-10",total:15000})]));expect(result.findings.find(item=>item.ruleCode==="CA_AMOUNT_VARIATION")?.description).toContain("50.0%");});
 it("PIX de aluguel continua sendo serviço mensal",()=>{const result=analyzeFinancialHistory(input([entry({id:"apr",description:"PIX Aluguel",dueDate:"2026-04-10",paymentDate:"2026-04-11",competenceDate:"2026-04-11"})]));expect(result.findings.some(item=>item.ruleCode==="CA_COMPETENCE_DIVERGENCE")).toBe(true);});
 it("compra avulsa usa o dia exato do pagamento",()=>{for(const competenceDate of ["2026-04-01","2026-04-12"]){const result=analyzeFinancialHistory(input([entry({id:"purchase",description:"PIX compra de material",dueDate:"2026-04-10",paymentDate:"2026-04-12",competenceDate})]));expect(result.findings.some(item=>item.ruleCode==="CA_COMPETENCE_DIVERGENCE")).toBe(competenceDate!=="2026-04-12");}});
 it("não transforma data de vencimento em data de pagamento",()=>{const result=analyzeFinancialHistory(input([entry({id:"purchase",description:"PIX compra de material",dueDate:"2026-04-10",paymentDate:null})]));expect(result.findings.some(item=>item.ruleCode==="CA_COMPETENCE_PAYMENT_UNAVAILABLE")).toBe(true);});
 it("não cobra obrigação que ainda não venceu no mês em andamento",()=>{const result=analyzeFinancialHistory({...input([]),today:"2026-04-05"});expect(result.findings.some(item=>item.ruleCode==="CA_MISSING_RECURRING")).toBe(false);});
 it("aprende obrigação presente nos dois últimos meses e não junta impostos diferentes",()=>{const result=analyzeFinancialHistory({...input([]),history:["02","03"].flatMap(month=>[entry({id:`irpj-${month}`,description:"DARF IRPJ",counterparty:"RECEITA FEDERAL",dueDate:`2026-${month}-20`}),entry({id:`csll-${month}`,description:"DARF CSLL",counterparty:"RECEITA FEDERAL",dueDate:`2026-${month}-20`})])});expect(result.profiles).toHaveLength(2);expect(result.findings.filter(item=>item.ruleCode==="CA_MISSING_RECURRING")).toHaveLength(2);});
 it("incorpora vencidos anteriores sem duplicar o título do período",()=>{const current=entry({id:"apr",dueDate:"2026-04-10",status:"ATRASADO",paid:0,outstanding:500});const result=analyzeFinancialHistory({...input([current]),overdueEntries:[current,entry({id:"old",dueDate:"2025-12-10",status:"ATRASADO",paid:0,outstanding:500})]});expect(result.findings.filter(item=>item.ruleCode==="CA_OVERDUE")).toHaveLength(2);});
});

it("a categoria atual não muda a identidade usada para comparar a categoria anterior",()=>{const history=["01","02","03"].map(month=>entry({id:month,description:"Mensalidade do escritório",counterparty:"FORNECEDOR",categories:["Outras despesas"],dueDate:`2026-${month}-10`,competenceDate:null}));const result=analyze(history,[entry({id:"apr",description:"Mensalidade do escritório",counterparty:"FORNECEDOR",categories:["Aluguel"],dueDate:"2026-04-10",competenceDate:null})]);expect(result.findings.some(item=>item.ruleCode==="CA_CATEGORY_DIVERGENCE")).toBe(true);});
