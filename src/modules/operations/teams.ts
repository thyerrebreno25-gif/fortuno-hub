/** The same identity is used when saving, filtering and grouping legacy team names. */
export const STANDARD_OPERATION_TEAMS = ["Força Tática Financeira", "Elite do Fluxo"];
export function teamKey(value: string | null | undefined) {
  const key = (value || "").normalize("NFD").replace(/\p{M}/gu, "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
  // Known historical spelling in the organization's routine records.
  return key === "forca tatitca financeira" ? "forca tatica financeira" : key;
}
export function canonicalTeam(value: string | null | undefined): string | null {
  const key = teamKey(value);
  if (!key) return null;
  const standard = STANDARD_OPERATION_TEAMS.find(name => teamKey(name) === key);
  if (standard) return standard;
  return value!.normalize("NFC").replace(/[\u200B-\u200D\uFEFF]/g, "").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR").replace(/(^|\s)\p{L}/gu, letter => letter.toLocaleUpperCase("pt-BR")).replace(/\b(Do|Da|De|Dos|Das|E)\b/g, word => word.toLocaleLowerCase("pt-BR"));
}
export function operationTeamOptions(values: Array<string | null | undefined> = []) {
  const teams = new Map<string, string>();
  for (const value of [...STANDARD_OPERATION_TEAMS, ...values]) {
    const name = canonicalTeam(value);
    if (name && !teams.has(teamKey(name))) teams.set(teamKey(name), name);
  }
  return [...teams.values()].sort((a, b) => a.localeCompare(b, "pt-BR"));
}
export function teamAliases(selected: string, values: Array<string | null | undefined>) {
  return [...new Set([selected, canonicalTeam(selected), ...values.filter(value => teamKey(value) === teamKey(selected))].filter((value): value is string => Boolean(value)))];
}
