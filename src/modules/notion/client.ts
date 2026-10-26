export type Option = { label: string; color?: string; id?: string };
export type Field = { type: string; propertyId: string; values: Option[]; relationCount: number; hasMore: boolean };
export type Item = { id: string; kind: string; title: string; url?: string; editedAt?: string; properties?: Record<string, string>; fields?: Record<string, Field>; unavailable?: boolean };
export type Column = { name: string; type: string; options: Option[] };
export type Block = { id: string; type: string; text: string; checked: boolean; hasChildren: boolean; targetId?: string; targetKind?: string };
export type Detail = { item: Item; items?: Item[]; columns?: string[]; columnSchema?: Column[]; sources?: Item[]; blocks?: Block[]; cursor: string | null };
export async function notionRequest<T>(params: Record<string, string>, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/integrations/notion?${new URLSearchParams(params)}`, { ...init, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Não foi possível consultar o Notion.");
  return data;
}
export function fieldColor(color?: string) {
  return ({ red: "red", orange: "orange", yellow: "yellow", green: "green", blue: "blue", purple: "violet", pink: "pink", brown: "orange", gray: "gray" } as Record<string, string>)[color || ""] || "gray";
}
export function defaultColumns(columns: Column[]) {
  const priority = ["aviso", "razao social", "nome fantasia", "cluster", "squad", "contas a pagar", "contas a receber", "supervisao", "escopo"];
  const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const ordered = [...columns].sort((a, b) => {
    const score = (column: Column) => column.type === "title" ? -1 : priority.includes(normalized(column.name)) ? priority.indexOf(normalized(column.name)) : 100;
    return score(a) - score(b);
  });
  return ordered.slice(0, 10).map((column) => column.name);
}
