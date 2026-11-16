import {describe,it,expect} from "vitest";
import {completionBlocker} from "./completion";
describe("encerramento da auditoria",()=>{
 it.each(["IDENTIFIED","SENT","IN_PROGRESS","RETURNED","PENDING_VALIDATION"])("bloqueia apontamento %s",status=>expect(completionBlocker([{id:"f",ruleCode:null,status}],[])).toBeTruthy());
 it("exige revisão de todos os itens obrigatórios",()=>expect(completionBlocker([],[{id:"c",mandatory:true,status:"PENDING"}])).toBeTruthy());
 it("não encerra uma não conformidade sem correção validada",()=>expect(completionBlocker([],[{id:"c",mandatory:true,status:"NON_COMPLIANT"}])).toBeTruthy());
 it("libera após validar os ajustes e justificar os descartes",()=>expect(completionBlocker([{id:"f",ruleCode:"CHECKLIST:c",status:"VALIDATED"},{id:"g",ruleCode:null,status:"DISMISSED"}],[{id:"c",mandatory:true,status:"NON_COMPLIANT"}])).toBeNull());
});
