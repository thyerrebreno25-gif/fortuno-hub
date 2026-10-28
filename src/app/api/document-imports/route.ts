import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { importKinds, reviewSchema } from "@/modules/document-imports/model";
import { authorizedCompany, importAccess, importOptions } from "@/modules/document-imports/server";

const kindSchema = z.enum(importKinds);
export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = kindSchema.safeParse(url.searchParams.get("kind"));
  if (!kind.success) return NextResponse.json({ error: "Tipo de importação inválido." }, { status: 400 });
  const access = await importAccess(kind.data);
  if (!access) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  if (!access.permission.canView) return NextResponse.json({ error: "Sem permissão para este módulo." }, { status: 403 });
  const clientId = url.searchParams.get("clientId") || "";
  if (url.searchParams.get("options") === "1") {
    if (!await authorizedCompany(access.member.organizationId, clientId)) return NextResponse.json({ error: "Empresa não encontrada." }, { status: 404 });
    try { return NextResponse.json(await importOptions(clientId, kind.data, url.searchParams.get("term")?.slice(0, 150))); }
    catch { return NextResponse.json({ error: "Não foi possível consultar o Conta Azul. Confira a conexão da empresa e tente novamente." }, { status: 502 }); }
  }
  const clients = await prisma.client.findMany({ where: { organizationId: access.member.organizationId, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, document: true, contaAzulConnection: { select: { active: true, status: true } } } });
  const drafts = clientId ? await prisma.documentImportReview.findMany({ where: { organizationId: access.member.organizationId, clientId, kind: kind.data }, orderBy: { updatedAt: "desc" }, take: 100 }) : [];
  return NextResponse.json({ clients, drafts, permission: access.permission, mode: "SIMULATION" });
}
const createSchema = z.object({ clientId: z.string().min(1).max(100), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), fileName: z.string().min(1).max(250), data: reviewSchema });
export async function POST(request: Request) {
  const body = createSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Arquivo ou dados de revisão inválidos." }, { status: 400 });
  const { data, clientId, fingerprint, fileName } = body.data;
  const access = await importAccess(data.kind);
  if (!access) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  if (!access.permission.canImport || !access.permission.canCreate) return NextResponse.json({ error: "Sem permissão para importar." }, { status: 403 });
  if (!await authorizedCompany(access.member.organizationId, clientId)) return NextResponse.json({ error: "Empresa não encontrada." }, { status: 404 });
  const key = { organizationId: access.member.organizationId, clientId, kind: data.kind, fingerprint };
  const existing = await prisma.documentImportReview.findUnique({ where: { organizationId_clientId_kind_fingerprint: key } });
  const draft = await prisma.documentImportReview.upsert({ where: { organizationId_clientId_kind_fingerprint: key }, create: { ...key, fileName, data: data as Prisma.InputJsonValue, userId: access.member.userId }, update: {} });
  return NextResponse.json({ draft, duplicate: Boolean(existing), mode: "SIMULATION" });
}
