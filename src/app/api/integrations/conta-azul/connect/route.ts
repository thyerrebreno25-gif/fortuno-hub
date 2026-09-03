import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { findAuthorizedClient, getPurchaseInvoiceMember, getPurchaseInvoicePermission } from "@/modules/purchase-invoices/server/auth";
import { buildContaAzulAuthorizationUrl, getContaAzulRedirectUri } from "@/modules/purchase-invoices/server/conta-azul";

const STATE_COOKIE = "fortuno_conta_azul_oauth_state";

type OAuthReturnTarget = "connections" | "invoices";

function getReturnTarget(url: URL): OAuthReturnTarget {
  return url.searchParams.get("returnTo") === "connections"
    ? "connections"
    : "invoices";
}

function buildReturnUrl(
  request: Request,
  returnTarget: OAuthReturnTarget,
  clientId: string,
  error: string,
) {
  const url = new URL(
    returnTarget === "connections"
      ? "/integracoes/conta-azul"
      : "/notas-fiscais",
    request.url,
  );
  if (clientId) url.searchParams.set("clientId", clientId);
  url.searchParams.set("ca_error", error);
  return url;
}

export async function GET(request: Request) {
  const member = await getPurchaseInvoiceMember();
  if (!member) return NextResponse.redirect(new URL("/login", request.url));
  const permission = await getPurchaseInvoicePermission(member);
  const requestUrl = new URL(request.url);
  const clientId = requestUrl.searchParams.get("clientId") || "";
  const returnTarget = getReturnTarget(requestUrl);
  if (!permission.canManage) {
    return NextResponse.redirect(
      buildReturnUrl(request, returnTarget, clientId, "permission"),
    );
  }
  const client = await findAuthorizedClient(member, clientId);
  if (!client) {
    return NextResponse.redirect(
      buildReturnUrl(request, returnTarget, "", "client"),
    );
  }

  try {
    const state = `${crypto.randomBytes(32).toString("hex")}.${client.id}.${returnTarget}`;
    const redirectUri = getContaAzulRedirectUri(request);
    const response = NextResponse.redirect(buildContaAzulAuthorizationUrl({ state, redirectUri }));
    response.cookies.set(STATE_COOKIE, state, {
      httpOnly: true,
      secure: new URL(request.url).protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });
    return response;
  } catch (error) {
    console.error("Erro ao iniciar OAuth Conta Azul:", error);
    return NextResponse.redirect(
      buildReturnUrl(request, returnTarget, client.id, "config"),
    );
  }
}
