type Row = { id: string; clientId: string; processId: string; title: string };
/** Possible duplicates require human selection; no automatic deletion or canonical winner. */
export function activityDuplicateGroups<T extends Row>(rows: T[]) {
  const groups = new Map<string, T[]>();
  for (const row of rows) { const key = JSON.stringify([row.clientId, row.processId, row.title.trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, " ")]); groups.set(key, [...(groups.get(key) || []), row]); }
  const duplicates = new Map<string, number>();
  for (const group of groups.values()) if (group.length > 1) for (const row of group) duplicates.set(row.id, group.length);
  return duplicates;
}
