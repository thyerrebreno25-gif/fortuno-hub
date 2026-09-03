import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findAuthorizedClient, getPurchaseInvoiceMember, getPurchaseInvoicePermission } from "@/modules/purchase-invoices/server/auth";
import { encryptIntegrationSecret } from "@/modules/purchase-invoices/server/crypto";
import { decodeTokenProfile, exchangeContaAzulCode, getContaAzulRedirectUri } from "@/modules/purchase-invoices/server/conta-azul";

const STATE_COOKIE = "fortuno_conta_azul_oauth_state";

type OAuthReturnTarget = "connections" | "invoices";

function parseOAuthState(state: string): {
  clientId: string;
  returnTarget: OAuthReturnTarget;
} {
  const separator = state.indexOf(".");
  const payload = separator >= 0 ? state.slice(separator + 1) : "";

  if (payload.endsWith(".connections")) {
    return {
      clientId: payload.slice(0, -".connections".length),
      returnTarget: "connections",
    };
  }

  if (payload.endsWith(".invoices")) {
    return {
      clientId: payload.slice(0, -".invoices".length),
      returnTarget: "invoices",
    };
  }

  // Compatibilidade com autorizações iniciadas antes da central de vínculos.
  return { clientId: payload, returnTarget: "invoices" };
}

function redirectBack(
  request: Request,
  clientId: string,
  key: string,
  value: string,
  returnTarget: OAuthReturnTarget,
) {
  const url = new URL(
    returnTarget === "connections"
      ? "/integracoes/conta-azul"
      : "/notas-fiscais",
    request.url,
  );
  if (clientId) url.searchParams.set("clientId", clientId);
  url.searchParams.set(key, value);
  const response = NextResponse.redirect(url);
  response.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
export async function GET(request: Request) {
  const member = await getPurchaseInvoiceMember();
  if (!member) return NextResponse.redirect(new URL("/login", request.url));
  const permission = await getPurchaseInvoicePermission(member);

  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const { clientId, returnTarget } = parseOAuthState(state);

  if (!permission.canManage) {
    return redirectBack(
      request,
      clientId,
      "ca_error",
      "permission",
      returnTarget,
    );
  }

  const cookieState = request.headers.get("cookie")
    ?.split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${STATE_COOKIE}=`))
    ?.slice(STATE_COOKIE.length + 1);
  if (url.searchParams.get("error")) {
    return redirectBack(
      request,
      clientId,
      "ca_error",
      url.searchParams.get("error") || "oauth",
      returnTarget,
    );
  }
  if (!code || !state || !cookieState || decodeURIComponent(cookieState) !== state) {
    return redirectBack(
      request,
      clientId,
      "ca_error",
      "invalid_state",
      returnTarget,
    );
  }

  const client = await findAuthorizedClient(member, clientId);
  if (!client) {
    return redirectBack(
      request,
      "",
      "ca_error",
      "client",
      returnTarget,
    );
  }

  try {
    const tokens = await exchangeContaAzulCode({ code, redirectUri: getContaAzulRedirectUri(request) });
    const profile = decodeTokenProfile(tokens.access_token);
    await prisma.contaAzulConnection.upsert({
      where: { clientId: client.id },
      create: {
        organizationId: member.organizationId,
        clientId: client.id,
        encryptedAccessToken: encryptIntegrationSecret(tokens.access_token),
        encryptedRefreshToken: encryptIntegrationSecret(tokens.refresh_token),
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        scopes: tokens.scope?.split(" ").filter(Boolean) || [],
        externalTenantId: profile.externalTenantId,
        externalTenantName: profile.externalTenantName,
        connectedByUserId: member.userId,
        status: "CONNECTED",
        active: true,
      },
      update: {
        encryptedAccessToken: encryptIntegrationSecret(tokens.access_token),
        encryptedRefreshToken: encryptIntegrationSecret(tokens.refresh_token),
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        scopes: tokens.scope?.split(" ").filter(Boolean) || [],
        externalTenantId: profile.externalTenantId,
        externalTenantName: profile.externalTenantName,
        connectedByUserId: member.userId,
        status: "CONNECTED",
        active: true,
        lastError: null,
      },
    });
    return redirectBack(
      request,
      client.id,
      "ca",
      "connected",
      returnTarget,
    );
  } catch (error) {
    console.error("Callback OAuth Conta Azul:", error);
    return redirectBack(
      request,
      client.id,
      "ca_error",
      "callback",
      returnTarget,
    );
  }
}
