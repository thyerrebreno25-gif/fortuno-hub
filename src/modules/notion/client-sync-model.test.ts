import { expect, it } from "vitest";
import { clientRow, hasClientSchema, matchClient, resolvePerson, type NotionClientRow } from "./client-sync-model";
const people = [{ id: "duda", name: "Eduarda Rocha", email: "eduarda@test.com" }, { id: "brunna", name: "Brunna Ferreira", email: "brunna@test.com" }, { id: "luana1", name: "Luana Cordeiro", email: "l1@test.com" }, { id: "luana2", name: "Luana Gomes", email: "l2@test.com" }];
const row: NotionClientRow = { id: "page", name: "Abismo Anhumas Ecoturismo LTDA", alias: "Abismo Anhumas", document: "12345678000190", payable: "Duda", receivable: "Luana Cordeiro", supervisor: "Pedro", squad: "Força Tática Financeira", cluster: "B", emails: [] };
it("requires confirmed aliases for nicknames and resolves exact full names", () => {
  expect(resolvePerson("Duda", people).id).toBeNull();
  expect(resolvePerson("Duda", people, { Duda: "Eduarda Rocha" }).id).toBe("duda");
  expect(resolvePerson("Brunna F.", people, { "Brunna F.": "Brunna Ferreira" }).id).toBe("brunna");
});
it("rejects ambiguous first names and unknown people", () => {
  expect(resolvePerson("Luana", people).id).toBeNull();
  expect(resolvePerson("Luana Cordeiro", people).id).toBe("luana1");
  expect(resolvePerson("Pedro", people).id).toBeNull();
});
it("matches formatted CNPJ before names", () => {
  expect(matchClient({ name: "Outra grafia", document: "12.345.678/0001-90", serviceAliases: null }, [row]).row?.id).toBe("page");
});
it("never guesses among duplicate CNPJs or duplicate business names", () => {
  const client = { name: row.name, document: row.document, serviceAliases: null };
  expect(matchClient(client, [row, { ...row, id: "duplicate" }]).row).toBeNull();
  expect(matchClient({ ...client, document: null }, [row, { ...row, id: "duplicate", document: "11111111000111" }]).row).toBeNull();
});
it("an explicit page link resolves duplicates but never conflicting CNPJ", () => {
  expect(matchClient({ name: row.name, document: row.document, serviceAliases: null }, [row, { ...row, id: "duplicate" }], "page").row?.id).toBe("page");
  expect(matchClient({ name: row.name, document: "99999999000199", serviceAliases: null }, [row], "page").row).toBeNull();
});
it("uses exact normalized business aliases, not partial fuzzy company names", () => {
  expect(matchClient({ name: "ABISMO ANHUMAS", document: null, serviceAliases: null }, [row]).row?.id).toBe("page");
  expect(matchClient({ name: "Abismo", document: null, serviceAliases: null }, [row]).row).toBeNull();
});
it("reads role fields and approved contact email fields without ingesting bank login information", () => {
  const result = clientRow({ id: "page", properties: { "Razão Social": { type: "title", title: [{ plain_text: row.name }] }, "Contas a Pagar": { type: "people", people: [{ name: "Duda" }] }, "Email operacional": { type: "email", email: "financeiro@cliente.com" }, "Login banco": { type: "email", email: "secreto@banco.com" } } });
  expect(result.name).toBe(row.name); expect(result.payable).toBe("Duda"); expect(result.emails).toEqual(["financeiro@cliente.com"]);
});
it("requires a client responsibility schema", () => {
  expect(hasClientSchema({ properties: { "Contas a Pagar": {}, "Contas a Receber": {}, Supervisão: {} } })).toBe(true);
  expect(hasClientSchema({ properties: { Nome: {} } })).toBe(false);
});
