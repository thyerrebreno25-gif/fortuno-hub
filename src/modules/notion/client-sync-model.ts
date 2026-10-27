import { list, object, propertyText, string } from "./model";
export const normalizeIdentity = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
const key = (value: string) => normalizeIdentity(value).replaceAll(" ", "");
const digits = (value: string | null) => (value || "").replace(/\D/g, "");
export type SyncPerson = { id: string; name: string | null; email: string };
export type NotionClientRow = { id: string; name: string; alias: string; document: string; payable: string; receivable: string; supervisor: string; squad: string; cluster: string; emails: string[] };
export function clientRow(raw: unknown): NotionClientRow {
  const page = object(raw), properties = object(page.properties);
  const read = (...names: string[]) => {
    const found = Object.entries(properties).find(([name]) => names.map(key).includes(key(name)));
    return found ? propertyText(found[1]).trim() : "";
  };
  const name = Object.values(properties).filter((value) => object(value).type === "title").map((value) => propertyText(value)).join("");
  const emails = Object.entries(properties).filter(([name]) => ["email", "emails", "emailoperacional", "emaildocliente", "emailfinanceiro", "emaildecontato", "emailsfinanceiros"].includes(key(name))).flatMap(([, value]) => propertyText(value).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map((email) => email.toLowerCase());
  return { id: string(page.id), name, alias: read("Nome Fantasia"), document: digits(read("CNPJ", "CPF/CNPJ", "CNPJ/CPF", "Documento")), payable: read("Contas a Pagar"), receivable: read("Contas a Receber"), supervisor: read("Supervisão", "Supervisor", "Líder da operação"), squad: read("Squad"), cluster: read("Cluster").toUpperCase(), emails: [...new Set(emails)] };
}
export function resolvePerson(label: string, people: SyncPerson[], aliases: Record<string, string> = {}) {
  if (!label.trim()) return { id: null, issue: "não informado no Notion" };
  const mapped = Object.entries(aliases).find(([name]) => normalizeIdentity(name) === normalizeIdentity(label))?.[1] || label;
  const exact = people.filter((person) => person.id === mapped || person.email.toLowerCase() === mapped.toLowerCase() || normalizeIdentity(person.name || "") === normalizeIdentity(mapped));
  if (exact.length === 1) return { id: exact[0].id, issue: null };
  const tokens = normalizeIdentity(mapped).split(" ");
  const matches = people.filter((person) => {
    const parts = normalizeIdentity(person.name || "").split(" ");
    return tokens[0] === parts[0] && tokens.every((token, index) => index === 0 || parts.slice(1).some((part) => token === part || token.length === 1 && part.startsWith(token)));
  });
  return matches.length === 1 ? { id: matches[0].id, issue: null } : { id: null, issue: matches.length > 1 ? `nome ambíguo: ${label}` : `colaborador não localizado: ${label}` };
}
export function matchClient(client: { name: string; document: string | null; serviceAliases: string | null }, rows: NotionClientRow[], pinned?: string | null) {
  const document = digits(client.document);
  const pinnedRows = pinned ? rows.filter((row) => row.id === pinned && (!document || !row.document || document === row.document)) : [];
  if (pinnedRows.length === 1) return { row: pinnedRows[0], issue: null };
  const documents = document.length >= 11 ? rows.filter((row) => row.document === document) : [];
  if (documents.length) return documents.length === 1 ? { row: documents[0], issue: null } : { row: null, issue: "CNPJ duplicado no Notion" };
  const names = [client.name, ...(client.serviceAliases || "").split(/[,;\n]/)].map(normalizeIdentity).filter(Boolean);
  const matches = rows.filter((row) => (!document || !row.document || document === row.document) && [row.name, row.alias].some((name) => name && names.includes(normalizeIdentity(name))));
  return matches.length === 1 ? { row: matches[0], issue: null } : { row: null, issue: matches.length > 1 ? "empresa duplicada/ambígua no Notion" : "empresa não localizada no Notion" };
}
export function hasClientSchema(source: unknown) {
  const names = Object.keys(object(object(source).properties)).map(key);
  return ["contasapagar", "contasareceber"].every((name) => names.includes(name)) && names.some((name) => ["supervisao", "supervisor", "liderdaoperacao"].includes(name));
}
export function readAliases(value: unknown): Record<string, string> {
  return Object.fromEntries(Object.entries(object(value)).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}
export function readRows(value: unknown) { return list(value).filter((page) => !object(page).archived && !object(page).in_trash).map(clientRow); }
