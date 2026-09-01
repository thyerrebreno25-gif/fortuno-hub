import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function getKey() {
  const raw = (
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY ||
    process.env.GMAIL_TOKEN_ENCRYPTION_KEY ||
    ""
  ).trim();
  if (!raw) {
    throw new Error("INTEGRATION_TOKEN_ENCRYPTION_KEY não configurada.");
  }
  const key = /^[a-f0-9]{64}$/i.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("A chave de criptografia das integrações deve representar 32 bytes.");
  }
  return key;
}
export function encryptIntegrationSecret(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(".");
}

export function decryptIntegrationSecret(value: string) {
  const [version, iv, tag, data] = value.split(".");
  if (version !== "v1" || !iv || !tag || !data) {
    throw new Error("Credencial criptografada inválida.");
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(data, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
