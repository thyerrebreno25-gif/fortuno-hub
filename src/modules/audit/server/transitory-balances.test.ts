import {beforeEach,afterEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({request:vi.fn()}));vi.mock("server-only",()=>({}));vi.mock("@/modules/purchase-invoices/server/conta-azul",()=>({contaAzulRequest:m.request}));
import {auditTransitoryBalances} from "./transitory-balances";
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));m.request.mockReset();m.request.mockImplementation(async(_client:string,path:string)=>{
 if(path.includes("contas-financeiras?"))return {itens:[{id:"a",nome:"Cielo",tipo:"MEIOS_RECEBIMENTO"},{id:"b",nome:"XP",tipo:"INVESTIMENTO"},{id:"c",nome:"Inter",tipo:"CONTA_CORRENTE"}],itens_totais:3};
 if(path.endsWith("saldo-atual"))return {saldo_atual:100};
 if(path.includes("/contas-a-receber?"))return {itens:[{id:"p"}],itens_totais:1};
 if(path.includes("/baixas?"))return [{id:"settle",data_pagamento:"2026-11-01",conta_financeira:"a",valor_composicao:{valor_liquido:100}}];
 return {itens:[],itens_totais:0};
 });});afterEach(()=>vi.useRealTimers());
it("reconstructs the closing balance only for transit accounts using the public API",async()=>{const balances=await auditTransitoryBalances("c","2026-10-31");expect(balances).toHaveLength(1);expect(balances[0]).toMatchObject({name:"Cielo",balanceCents:0,method:"RECONSTRUCTED"});expect(m.request.mock.calls.every(([,path])=>!path.includes("eventos-financeiros")&&!path.includes("1900-01-01"))).toBe(true);const call=m.request.mock.calls.find(([,path])=>path.includes("contas-a-receber?"))!;const query=new URL(call[1],"https://api.test").searchParams;expect(query.get("data_pagamento_de")).toBe("2026-11-01");expect(query.get("data_alteracao_de")).toBe("2026-11-01T00:00:00");});
it("does not label an intraday balance as the closing balance",async()=>{expect((await auditTransitoryBalances("c","2026-11-01"))[0].balanceCents).toBeNull();expect(m.request).toHaveBeenCalledTimes(1);});
it("preserves a provider failure as unavailable",async()=>{const impl=m.request.getMockImplementation()!;m.request.mockImplementation((client:string,path:string)=>path.endsWith("saldo-atual")?Promise.reject(new Error("unavailable")):impl(client,path));expect((await auditTransitoryBalances("c","2026-10-31"))[0].balanceCents).toBeNull();});
