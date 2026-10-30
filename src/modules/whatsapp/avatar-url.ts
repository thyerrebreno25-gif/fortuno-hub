export function safeAvatarUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 8192) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    return ["whatsapp.net", "fbcdn.net", "whatsapp.com"].some(domain => host === domain || host.endsWith("." + domain)) ? url.href : null;
  } catch { return null; }
}
