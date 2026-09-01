import { prisma } from "@/lib/prisma";
import { decryptIntegrationSecret, encryptIntegrationSecret } from "./crypto";

const API_URL = "https://api-v2.contaazul.com";
const TOKEN_URL = `${API_URL}/oauth/token`;
const AUTH_URL = "https://login.contaazul.com/#/oauth/authorize";
export const CONTA_AZUL_SCOPE = "openid profile aws.cognito.signin.user.admin";

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type?: string;
  scope?: string;
};

function requiredEnv(name: "CONTA_AZUL_CLIENT_ID" | "CONTA_AZUL_CLIENT_SECRET") {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} não configurada.`);
  return value;
}
function basicAuthorization() {
  return `Basic ${Buffer.from(`${requiredEnv("CONTA_AZUL_CLIENT_ID")}:${requiredEnv("CONTA_AZUL_CLIENT_SECRET")}`).toString("base64")}`;
}

export function isContaAzulConfigured() {
  return Boolean(
    process.env.CONTA_AZUL_CLIENT_ID?.trim() &&
      process.env.CONTA_AZUL_CLIENT_SECRET?.trim() &&
      (process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY?.trim() ||
        process.env.GMAIL_TOKEN_ENCRYPTION_KEY?.trim()),
  );
}

export function getContaAzulRedirectUri(request: Request) {
  return (
    process.env.CONTA_AZUL_REDIRECT_URI?.trim() ||
    `${new URL(request.url).origin}/api/integrations/conta-azul/callback`
  );
}

export function buildContaAzulAuthorizationUrl({
  state,
  redirectUri,
}: {
  state: string;
  redirectUri: string;
}) {
  const params = new URLSearchParams({
    client_id: requiredEnv("CONTA_AZUL_CLIENT_ID"),
    redirect_uri: redirectUri,
    response_type: "code",
    state,
    scope: CONTA_AZUL_SCOPE,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function parseTokenResponse(response: Response): Promise<TokenResponse> {
  const body = (await response.json().catch(() => ({}))) as Partial<TokenResponse> & {
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !body.access_token || !body.refresh_token || !body.expires_in) {
    throw new Error(body.error_description || body.error || "Falha na autenticação com a Conta Azul.");
  }
  return body as TokenResponse;
}

export async function exchangeContaAzulCode({
  code,
  redirectUri,
}: {
  code: string;
  redirectUri: string;
}) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthorization(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  return parseTokenResponse(response);
}

async function refreshContaAzulConnection(connectionId: string) {
  const connection = await prisma.contaAzulConnection.findUnique({ where: { id: connectionId } });
  if (!connection || !connection.active) throw new Error("Conta Azul não está conectada para este cliente.");

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthorization(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      refresh_token: decryptIntegrationSecret(connection.encryptedRefreshToken),
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });

  try {
    const tokens = await parseTokenResponse(response);
    return prisma.contaAzulConnection.update({
      where: { id: connection.id },
      data: {
        encryptedAccessToken: encryptIntegrationSecret(tokens.access_token),
        encryptedRefreshToken: encryptIntegrationSecret(tokens.refresh_token),
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        scopes: tokens.scope?.split(" ").filter(Boolean) || connection.scopes,
        status: "CONNECTED",
        active: true,
        lastError: null,
      },
    });
  } catch (error) {
    await prisma.contaAzulConnection.update({
      where: { id: connection.id },
      data: { status: "ERROR", lastError: error instanceof Error ? error.message : "Falha ao renovar token." },
    });
    throw error;
  }
}

async function getValidConnection(clientId: string) {
  let connection = await prisma.contaAzulConnection.findUnique({ where: { clientId } });
  if (!connection || !connection.active) throw new Error("Conecte este cliente à Conta Azul antes de continuar.");
  if (connection.tokenExpiresAt.getTime() <= Date.now() + 60_000) {
    connection = await refreshContaAzulConnection(connection.id);
  }
  return connection;
}

export async function contaAzulRequest<T>(
  clientId: string,
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  const connection = await getValidConnection(clientId);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${decryptIntegrationSecret(connection.encryptedAccessToken)}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const response = await fetch(`${API_URL}${path}`, { ...init, headers, cache: "no-store" });
  if (response.status === 401 && retry) {
    await refreshContaAzulConnection(connection.id);
    return contaAzulRequest<T>(clientId, path, init, false);
  }

  const text = await response.text();
  const body = text ? (JSON.parse(text) as T & { message?: string; error?: string }) : ({} as T);
  if (!response.ok) {
    const apiError = body as { message?: string; error?: string };
    throw new Error(apiError.message || apiError.error || `Conta Azul respondeu com erro ${response.status}.`);
  }

  await prisma.contaAzulConnection.update({
    where: { id: connection.id },
    data: { lastSyncAt: new Date(), lastError: null, status: "CONNECTED" },
  });
  return body;
}

export function decodeTokenProfile(accessToken: string) {
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return {};
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    return {
      externalTenantId: typeof data.tenant_id === "string" ? data.tenant_id : typeof data.sub === "string" ? data.sub : null,
      externalTenantName: typeof data.name === "string" ? data.name : typeof data.email === "string" ? data.email : null,
    };
  } catch {
    return {};
  }
}
