import { object, text } from "./uazapi";
export type DirectoryKind = "CONTACT" | "GROUP";
export function directoryPage(body: unknown, kind: DirectoryKind, offset: number, legacy = false) {
  const root=object(body), field=kind === "GROUP" ? "groups" : "contacts";
  const raw=Array.isArray(body) ? body : root[field];
  if (!Array.isArray(raw)) throw new Error("A Uazapi retornou uma lista de contatos ou grupos inválida.");
  const entries = new Map<string,{externalId:string;kind:DirectoryKind;displayName:string}>();
  for (const value of raw) {
    const row=object(value), externalId=text(row.jid || row.JID || row.wa_chatid,150).toLowerCase();
    if (!(kind === "GROUP" ? /^\d+(?:-\d+)?@g\.us$/ : /^\d+@(s\.whatsapp\.net|lid)$/).test(externalId)) continue;
    const displayName=text(kind === "GROUP" ? row.Name || row.name : row.contact_name || row.contact_FirstName || row.name,250).trim() || externalId.split("@")[0];
    const previous=entries.get(externalId);
    if (!previous || previous.displayName === externalId.split("@")[0]) entries.set(externalId,{externalId,kind,displayName});
  }
  if (raw.length && !entries.size) throw new Error("A Uazapi não retornou identificadores válidos na agenda.");
  const pagination=object(root.pagination);
  const hasMore = !legacy && !Array.isArray(body) && (typeof pagination.hasMore === "boolean" ? pagination.hasMore : raw.length >= 200);
  const nextOffset=pagination.nextOffset === undefined ? offset+raw.length : Number(pagination.nextOffset);
  if (hasMore && (!Number.isSafeInteger(nextOffset) || nextOffset <= offset || !raw.length)) throw new Error("A paginação da agenda não avançou.");
  return {entries:[...entries.values()],hasMore,nextOffset};
}

export const CURRENT_DIRECTORY_PREFIX = "address-book-v1:";
export function currentDirectoryVisibility() {
 return {OR:[{kind:"GROUP"},{kind:"CONTACT",generation:{startsWith:CURRENT_DIRECTORY_PREFIX}}]};
}
