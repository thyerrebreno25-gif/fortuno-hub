import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findAuthorizedClient, getPurchaseInvoiceMember, getPurchaseInvoicePermission } from "@/modules/purchase-invoices/server/auth";
import { encryptIntegrationSecret } from "@/modules/purchase-invoices/server/crypto";
import { decodeTokenProfile, exchangeContaAzulCode, getContaAzulRedirectUri } from "@/modules/purchase-invoices/server/conta-azul";

const STATE_COOKIE = "fortuno_conta_azul_oauth_state";

function redirectBack(request: Request, clientId: string, key: string, value: string) {
  const url = new URL("/notas-fiscais", request.url);
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
  if (!permission.canManage) return redirectBack(request, "", "ca_error", "permission");

  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const cookieState = request.headers.get("cookie")
    ?.split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${STATE_COOKIE}=`))
    ?.slice(STATE_COOKIE.length + 1);
  const clientId = state.split(".").at(-1) || "";

  if (url.searchParams.get("error")) return redirectBack(request, clientId, "ca_error", url.searchParams.get("error") || "oauth");
  if (!code || !state || !cookieState || decodeURIComponent(cookieState) !== state) {
    return redirectBack(request, clientId, "ca_error", "invalid_state");
  }

  const client = await findAuthorizedClient(member, clientId);
  if (!client) return redirectBack(request, "", "ca_error", "client");

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
    return redirectBack(request, client.id, "ca", "connected");
  } catch (error) {
    console.error("Callback OAuth Conta Azul:", error);
    return redirectBack(request, client.id, "ca_error", "callback");
  }
}
