export function isContactName(value: string | null | undefined) {
  const name=value?.trim();
  return Boolean(name && !/@(?:lid|s\.whatsapp\.net|g\.us)$/.test(name) && !/^[+\d\s().-]+$/.test(name));
}
export function messageSenderName(name:string|null, fallback:string, outbound:boolean) {
  return isContactName(name) ? name! : outbound ? "Fortuno" : fallback;
}
