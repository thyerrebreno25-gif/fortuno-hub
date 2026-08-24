export const DAILY_MFA_COOKIE_NAME = "fortuno_mfa_daily";
export const DAILY_MFA_COOKIE_MAX_AGE_SECONDS = 36 * 60 * 60;

const TOKEN_VERSION = 1;
const SAO_PAULO_TIME_ZONE = "America/Sao_Paulo";

type DailyMfaPayload = {
  version: number;
  userId: string;
  day: string;
  issuedAt: number;
  expiresAt: number;
};

function signingSecret(): string {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!secret) {
    throw new Error("A chave de assinatura da verificação diária não está configurada.");
  }
  return secret;
}

function saoPauloDay(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SAO_PAULO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

async function signingKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function createDailyMfaToken(
  userId: string,
  now = new Date(),
): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const payload: DailyMfaPayload = {
    version: TOKEN_VERSION,
    userId,
    day: saoPauloDay(now),
    issuedAt,
    expiresAt: issuedAt + DAILY_MFA_COOKIE_MAX_AGE_SECONDS,
  };
  const encodedPayload = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(),
    new TextEncoder().encode(encodedPayload),
  );
  return `${encodedPayload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function verifyDailyMfaToken(
  token: string | undefined,
  userId: string,
  now = new Date(),
): Promise<boolean> {
  if (!token) return false;
  try {
    const [encodedPayload, encodedSignature, extra] = token.split(".");
    if (!encodedPayload || !encodedSignature || extra) return false;
    const verified = await crypto.subtle.verify(
      "HMAC",
      await signingKey(),
      base64UrlDecode(encodedSignature),
      new TextEncoder().encode(encodedPayload),
    );
    if (!verified) return false;

    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(encodedPayload)),
    ) as Partial<DailyMfaPayload>;
    const currentTime = Math.floor(now.getTime() / 1000);
    return payload.version === TOKEN_VERSION
      && payload.userId === userId
      && payload.day === saoPauloDay(now)
      && typeof payload.issuedAt === "number"
      && payload.issuedAt <= currentTime + 60
      && typeof payload.expiresAt === "number"
      && payload.expiresAt >= currentTime;
  } catch {
    return false;
  }
}
