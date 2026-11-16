import {describe,it,expect} from "vitest";
import {isTransitoryAccount,transitoryBalanceFindings} from "./transitory-accounts";
describe("saldo de contas transitórias",()=>{
 it.each(["Cielo","Getnet","iFood","Meios de recebimento - loja","Stone"])("inclui %s",name=>expect(isTransitoryAccount(name,"")).toBe(true));
 it.each([["Cielo","CONTA_CORRENTE"],["Investimentos XP","INVESTIMENTO"],["Poupança","POUPANCA"],["Caixa da loja","CAIXA"],["Banco Inter","CONTA_CORRENTE"]])("exclui %s %s",(name,type)=>expect(isTransitoryAccount(name,type)).toBe(false));
 it("distingue zero, saldo não zerado e consulta indisponível",()=>{const result=transitoryBalanceFindings([0,12500,null].map((balanceCents,index)=>({id:String(index),name:"Cielo",type:"ADQUIRENTE",date:"2026-10-31",balanceCents,method:balanceCents===null?"UNAVAILABLE":"RECONSTRUCTED"})));expect(result.map(item=>item.ruleCode)).toEqual(["CA_TRANSITORY_NONZERO","CA_TRANSITORY_BALANCE_UNAVAILABLE"]);expect(result[1].amount).toBeNull();});
});
