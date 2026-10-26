import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentMember, getRolePermissions } from "@/modules/permissions/permissions";
import { decryptIntegrationSecret } from "@/modules/purchase-invoices/server/crypto";
import { object } from "./model";

export class NotionError extends Error { constructor(message: string, public status = 400) { super(message); } }
export async function notionAccess(manage = false) {
  const member = await getCurrentMember();
  if (!member) throw new NotionError("Sessão inválida.", 401);
  const permission = (await getRolePermissions(member.organizationId, member.role)).NOTION;
  if (member.role === "CLIENT" || !permission.canView || (manage && !permission.canManage)) throw new NotionError("Seu perfil não permite esta ação no Notion.", 403);
  return { member, permission };
}
export async function notionFetch(token: string, path: string, body?: unknown) {
  let response: Response;
  try {
    response = await fetch(`https://api.notion.com/v1${path}`, { method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${token}`, "Notion-Version": "2026-03-11", "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000) });
  } catch { throw new NotionError("O Notion não respondeu. Tente novamente.", 502); }
  if (!response.ok) {
    if (response.status === 401) throw new NotionError("A chave do Notion é inválida ou foi revogada. Reconecte a integração.", 400);
    if (response.status === 403) throw new NotionError("A integração não tem permissão para ler este conteúdo no Notion.", 403);
    if (response.status === 404) throw new NotionError("Conteúdo não encontrado. Compartilhe a página ou base com a integração no Notion.", 404);
    if (response.status === 429) throw new NotionError("O Notion limitou as consultas. Aguarde alguns segundos e tente novamente.", 429);
    throw new NotionError("Não foi possível consultar o Notion. Tente novamente.", 502);
  }
  return object(await response.json());
}
export async function notionToken(organizationId: string) {
  const connection = await prisma.notionConnection.findUnique({ where: { organizationId } });
  if (!connection) throw new NotionError("Conecte o Notion para consultar páginas e bases.");
  return decryptIntegrationSecret(connection.encryptedToken);
}
export function notionFailure(error: unknown) {
  if (error instanceof ZodError) return NextResponse.json({ error: "Confira os dados informados." }, { status: 400 });
  if (error instanceof NotionError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: "Não foi possível concluir a operação do Notion." }, { status: 500 });
}
