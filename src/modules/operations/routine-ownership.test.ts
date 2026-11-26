import {expect,it} from "vitest";
import {inheritedRoutineFamily,reconciliationOwner} from "./routine-ownership";
it("inherits payment calendars and card invoices while receipt work follows receipt reconciliation",()=>{
 for(const name of ["Agenda de Pagamentos","Agenda personalizada de pagamentos","Importação de Fatura de Cartão de Crédito","Conciliar Faturas de Cartão de Crédito"])expect(inheritedRoutineFamily(name)).toBe("payments");
 for(const name of ["Lançar Rendimentos de Aplicação","Importar Meios de Recebimento","Importação de Recebíveis","Emissão de Nota Fiscal","Emitir nota","Lançamento e Relação de Recebimentos"])expect(inheritedRoutineFamily(name)).toBe("receipts");
 for(const name of ["Auditoria Mensal","Envio de Relatório","Conciliação de Pagamentos","Conciliação de Recebimentos"])expect(inheritedRoutineFamily(name)).toBeNull();
});
it("uses this client's configured reconciliation owner and refuses conflicting primary routines",()=>{
 const row=(clientId:string,responsibleId:string|null,name="Conciliação de Pagamentos")=>({clientId,responsibleId,process:{name}});
 expect(reconciliationOwner([row("other","foreign"),row("client","ana"),row("client","bruna","Conciliação de Recebimentos")],"client","payments")).toBe("ana");
 expect(reconciliationOwner([row("client","ana"),row("client","ana")],"client","payments")).toBe("ana");
 expect(reconciliationOwner([row("other","ana")],"client","payments")).toBeNull();
 expect(()=>reconciliationOwner([row("client","ana"),row("client","bruna")],"client","payments")).toThrow("responsáveis diferentes");
});
