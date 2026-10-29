import { expect,it } from "vitest";
import { contractRejection } from "./contract-errors";
it("shows the rejected field and nested CA validation message",()=>{
  expect(contractRejection(400,{errors:[{field:"termos.data_inicio",message:"Data de início inválida"}]},"erro")).toContain("termos.data_inicio · Data de início inválida");
});
it("does not expose credentials, headers or complete API bodies",()=>{
  const result=contractRejection(422,{authorization:"private",errors:[{message:"Bearer private-token"},{message:"Confira o campo de vencimento"}],stack:"internal"},"erro");
  expect(result).toContain("Confira o campo de vencimento");expect(result).not.toContain("private");expect(result).not.toContain("internal");
});
it("uses a safe fallback and bounds the displayed response",()=>{
  expect(contractRejection(403,{},"Acesso ao módulo recusado")).toContain("Acesso ao módulo recusado");
  expect(contractRejection(400,{message:"x".repeat(5000)},"erro").length).toBeLessThanOrEqual(1200);
});
it("reads validation maps without exposing protected fields",()=>{
  const result=contractRejection(400,{errors:{"termos.numero":["Número já utilizado"],authorization:"private"}},"erro");
  expect(result).toContain("termos.numero · Número já utilizado");expect(result).not.toContain("private");
});
