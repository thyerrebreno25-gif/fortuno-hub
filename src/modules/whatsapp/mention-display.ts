export type DisplayMentionTarget = { phone?: string | null; id?: string | null; lid?: string | null; name: string | null };
export function displayMentionTargets(value: unknown): DisplayMentionTarget[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 2000).flatMap(row => row && typeof row === "object" && typeof row.name === "string" && row.name.trim() && row.name.length <= 250 && !/[\r\n]/.test(row.name) ? [{ name: row.name.trim(), phone: typeof row.phone === "string" ? row.phone : null, id: typeof row.id === "string" ? row.id : null, lid: typeof row.lid === "string" ? row.lid : null }] : []);
}
export function displayMentions(body: string, targets: unknown) {
  const names = new Map<string, string>();
  for (const target of displayMentionTargets(targets)) for (const id of [target.phone, target.id, target.lid]) {
    const number = id?.split("@")[0];
    if (number && /^\d{8,20}$/.test(number) && !names.has(number)) names.set(number, target.name!);
  }
  return body.replace(/(^|[\s([{])@(\d{8,20})(?:@(?:lid|s\.whatsapp\.net))?(?=\s|$|[.,!?:;)\]}])/g, (original, prefix: string, id: string) => names.has(id) ? `${prefix}@${names.get(id)}` : original);
}
export const hasNumericMention = (body: string) => /(?:^|[\s([{])@\d{8,20}(?:@(?:lid|s\.whatsapp\.net))?(?=\s|$|[.,!?:;)\]}])/.test(body);
