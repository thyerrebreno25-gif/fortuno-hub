import { expect, it } from "vitest";
import { classifyWhatsappArea, matchWhatsappGroup, mayAutomaticallyRoute, AUTOMATIC_WHATSAPP_PREFIX } from "./automatic-routing";
const client = { id: "a", name: "GREGORIO E MAGALHAES ADVOCACIA", document: "12345678000195", serviceAliases: "Gregório; GM Advocacia" };
it("recognizes the client in decorated group names and registered aliases", () => {
  for (const group of ["Fortuno • Gregório • Financeiro", "BPO | GM Advocacia", "Gregorio e Magalhaes Advocacia"]) expect(matchWhatsappGroup(group, [client]).client?.id).toBe("a");
});
it("does not confuse branches or equally matching customers", () => {
  const clients = [{ ...client, id: "go", name: "Impact Goiania", serviceAliases: null }, { ...client, id: "df", name: "Impact Brasilia", serviceAliases: null }];
  expect(matchWhatsappGroup("Fortuno Impact", clients).client).toBeNull();
  expect(matchWhatsappGroup("Fortuno Impact Brasília", clients).client?.id).toBe("df");
  expect(matchWhatsappGroup("Impact Goiania e Impact Brasilia", clients).ambiguous).toBe(true);
  expect(matchWhatsappGroup("Gregório", [client, { ...client, id: "b" }]).client).toBeNull();
});
it("recognizes a unique company brand without matching generic company words", () => {
  expect(matchWhatsappGroup("BPO • Gregorio", [{ ...client, serviceAliases: null }]).client?.id).toBe("a");
  expect(matchWhatsappGroup("Grupo Serviços Financeiro", [client]).client).toBeNull();
});
it.each(["Precisamos pagar o boleto do fornecedor", "Segue comprovante de pagamento", "Janela de pagamento de hoje"])("recognizes accounts payable: %s", body => expect(classifyWhatsappArea("Cliente", body).area).toBe("ACCOUNTS_PAYABLE"));
it.each(["Preciso emitir boleto para o cliente", "O cliente pagou via Pix", "Cliente precisa pagar a parcela", "Conferir os recebimentos", "Podem cobrar o cliente inadimplente?"])("recognizes accounts receivable: %s", body => expect(classifyWhatsappArea("Cliente", body).area).toBe("ACCOUNTS_RECEIVABLE"));
it.each(["Segue boleto", "Como está o financeiro?", "Preciso pagar fornecedor e emitir boleto", "Contas a pagar e contas a receber"])("leaves ambiguous financial content for triage: %s", body => expect(classifyWhatsappArea("Cliente", body).area).toBe("UNKNOWN"));
it("uses a general owner for greetings rather than guessing a financial area", () => expect(classifyWhatsappArea("Cliente", "Bom dia, tudo bem?").area).toBe("GENERAL"));
it("preserves manual assignments and conversations already answered by an operator", () => {
  expect(mayAutomaticallyRoute({ assignedToId: "manual", firstResponseAt: null, routingReason: "Transferido manualmente" }, "ACCOUNTS_PAYABLE")).toBeFalsy();
  expect(mayAutomaticallyRoute({ assignedToId: "owner", firstResponseAt: new Date(), routingReason: AUTOMATIC_WHATSAPP_PREFIX }, "ACCOUNTS_RECEIVABLE")).toBeFalsy();
  expect(mayAutomaticallyRoute({ assignedToId: "general", firstResponseAt: null, routingReason: AUTOMATIC_WHATSAPP_PREFIX }, "ACCOUNTS_PAYABLE")).toBeTruthy();
});

it("recognizes branch-specific words without confusing the other units of the same brand",()=>{
 const clients=[{...client,id:"lotus",name:"VELOCITY FLOR DE LOTUS LTDA",serviceAliases:null},{...client,id:"norte",name:"VELOCITY ASA NORTE LTDA",serviceAliases:null}];
 expect(matchWhatsappGroup("BPO | Flor de Lótus",clients).client?.id).toBe("lotus");expect(matchWhatsappGroup("Fortuno Velocity",clients).client).toBeNull();
 expect(classifyWhatsappArea("Cliente","[AudioMessage]").area).toBe("UNKNOWN");
});

it("recognizes financial group labels and plural payment requests",()=>{expect(classifyWhatsappArea("A Receber | Alldaya Marketing Digital","Bom dia").area).toBe("ACCOUNTS_RECEIVABLE");expect(classifyWhatsappArea("A Pagar | Alldaya Marketing Digital","Bom dia").area).toBe("ACCOUNTS_PAYABLE");expect(classifyWhatsappArea("Cliente","Os pagamentos saem hoje?").area).toBe("ACCOUNTS_PAYABLE");});
