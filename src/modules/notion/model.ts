export const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export const string = (value: unknown) => typeof value === "string" ? value : "";
export function propertyPathId(value: string) {
  // Notion already URL-encodes short property IDs in API responses.
  try { return encodeURIComponent(decodeURIComponent(value)); } catch { return encodeURIComponent(value); }
}
export const richText = (value: unknown) => list(value).map((part) => { const item = object(part); return string(item.plain_text) || string(object(item.text).content); }).join("");
export function propertyText(value: unknown, depth = 0): string {
  if (depth > 3) return "…";
  const prop = object(value), type = string(prop.type), data = prop[type];
  if (type === "title" || type === "rich_text") return richText(data);
  if (type === "checkbox") return data ? "Sim" : "Não";
  if (type === "date") { const date = object(data); return [string(date.start), string(date.end)].filter(Boolean).join(" → "); }
  if (type === "select" || type === "status") return string(object(data).name);
  if (type === "multi_select" || type === "people" || type === "files") return list(data).map((entry) => string(object(entry).name)).join(", ");
  if (type === "relation") return `${list(data).length} vínculo(s)`;
  if (type === "formula" || type === "rollup") return propertyText(data, depth + 1);
  if (type === "array") return list(data).map((entry) => propertyText(entry, depth + 1)).join(", ");
  return data == null ? "" : typeof data === "string" || typeof data === "number" ? String(data) : "";
}
export function notionItem(value: unknown) {
  const item = object(value), properties = object(item.properties);
  const title = richText(item.title) || Object.values(properties).filter((prop) => object(prop).type === "title").map((prop) => propertyText(prop)).join("") || "Sem título";
  return { id: string(item.id), kind: string(item.object), title, url: safeNotionUrl(item.url), editedAt: string(item.last_edited_time), properties: Object.fromEntries(Object.entries(properties).map(([key, prop]) => [key, propertyText(prop)])), fields: Object.fromEntries(Object.entries(properties).map(([key, value]) => {
    const prop = object(value), type = string(prop.type), data = prop[type];
    const values = type === "select" || type === "status" ? [data] : type === "multi_select" || type === "people" ? list(data) : [];
    return [key, { type, propertyId: string(prop.id), values: values.filter(Boolean).map((entry) => ({ label: string(object(entry).name), color: string(object(entry).color), id: string(object(entry).id) })), relationCount: type === "relation" ? list(data).length : 0, hasMore: Boolean(prop.has_more) }];
  })) };
}
export function notionColumns(value: unknown) {
  return Object.entries(object(object(value).properties)).map(([name, value]) => {
    const prop = object(value), type = string(prop.type);
    return { name, type, options: list(object(prop[type]).options).map((entry) => ({ label: string(object(entry).name), color: string(object(entry).color), id: string(object(entry).id) })) };
  });
}
export function notionQuery(value: unknown, params: { query: string; filterField?: string; filterValue?: string; sortField?: string; direction: string }) {
  const columns = notionColumns(value);
  const conditions: unknown[] = [];
  if (params.query.trim()) {
    const searchable = columns.filter((column) => ["title", "rich_text", "email", "phone_number", "url"].includes(column.type));
    if (searchable.length) conditions.push({ or: searchable.slice(0, 30).map((column) => ({ property: column.name, [column.type]: { contains: params.query.trim() } })) });
  }
  if (params.filterField && params.filterValue) {
    const column = columns.find((column) => column.name === params.filterField);
    if (!column || !["select", "status", "multi_select", "checkbox", "title", "rich_text", "email", "phone_number", "url"].includes(column.type)) throw new Error("Filtro inválido.");
    const operator = ["select", "status", "checkbox"].includes(column.type) ? "equals" : "contains";
    conditions.push({ property: column.name, [column.type]: { [operator]: column.type === "checkbox" ? params.filterValue === "true" : params.filterValue } });
  }
  const sort = columns.find((column) => column.name === params.sortField) || columns.find((column) => column.type === "title");
  return { ...(conditions.length ? { filter: conditions.length === 1 ? conditions[0] : { and: conditions } } : {}), ...(sort ? { sorts: [{ property: sort.name, direction: params.direction }] } : {}) };
}
export function safeNotionUrl(value: unknown) {
  try { const url = new URL(string(value)); return url.protocol === "https:" && (url.hostname === "notion.so" || url.hostname.endsWith(".notion.so") || url.hostname === "notion.com" || url.hostname.endsWith(".notion.com") || url.hostname.endsWith(".notion.site")) ? url.href : ""; } catch { return ""; }
}
export function notionBlock(value: unknown) {
  const item = object(value), type = string(item.type), data = object(item[type]);
  const text = richText(data.rich_text) || richText(data.caption) || string(data.title) || string(data.name) || (type === "table_row" ? list(data.cells).map(richText).join(" | ") : "");
  const targetId = string(data.page_id || data.database_id || data.data_source_id);
  return { id: string(item.id), type, text, checked: Boolean(data.checked), hasChildren: Boolean(item.has_children), expanded: false, depth: 0, ...(type === "link_to_page" && targetId ? { targetId, targetKind: data.database_id ? "database" : data.data_source_id ? "data_source" : "page" } : {}) };
}
