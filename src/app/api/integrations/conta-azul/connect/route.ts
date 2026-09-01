import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { findAuthorizedClient, getPurchaseInvoiceMember, getPurchaseInvoicePermission } from "@/modules/purchase-invoices/server/auth";
import { buildContaAzulAuthorizationUrl, getContaAzulRedirectUri } from "@/modules/purchase-invoices/server/conta-azul";

const STATE_COOKIE = "fortuno_conta_azul_oauth_state";

export async function GET(request: Request) {
  const member = await getPurchaseInvoiceMember();
  if (!member) return NextResponse.redirect(new URL("/login", request.url));
  const permission = await getPurchaseInvoicePermission(member);
  const clientId = new URL(request.url).searchParams.get("clientId") || "";
  if (!permission.canManage) return NextResponse.redirect(new URL(`/notas-fiscais?clientId=${clientId}&ca_error=permission`, request.url));
  const client = await findAuthorizedClient(member, clientId);
  if (!client) return NextResponse.redirect(new URL("/notas-fiscais?ca_error=client", request.url));

  try {
    const state = `${crypto.randomBytes(32).toString("hex")}.${client.id}`;
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
    return NextResponse.redirect(new URL(`/notas-fiscais?clientId=${client.id}&ca_error=config`, request.url));
  }
}
