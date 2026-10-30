import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { getServiceCenterMember, getWhatsAppPermission } from "@/modules/atendimento/auth";
import { canViewWhatsAppManagement } from "@/modules/whatsapp/management-access";
import { summarizeAssignments } from "@/modules/whatsapp/management-types";
import { WHATSAPP_SOURCES } from "@/modules/whatsapp/core";
export async function GET(request: Request) {
  const member = await getServiceCenterMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  const permission = await getWhatsAppPermission(member.organizationId, member.role);
  if (!canViewWhatsAppManagement(member.role, permission.canView)) return NextResponse.json({ error: "Acesso restrito à gestão." }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const status = params.get("status") || "OPEN";
  const assignee = params.get("assignee") || "ALL";
  const page = Number(params.get("page") || "1");
  const search = (params.get("search") || "").trim();
  if (!["OPEN", "RESOLVED", "ALL"].includes(status) || !Number.isSafeInteger(page) || page < 1 || page > 10000 || assignee.length > 200 || search.length > 200) return NextResponse.json({ error: "Filtro inválido." }, { status: 400 });
  const base: Prisma.ServiceTicketWhereInput = { organizationId: member.organizationId, source: { in: [...WHATSAPP_SOURCES] }, mergedIntoId: null, isSpam: false, status: { not: "SPAM" } };
  const where: Prisma.ServiceTicketWhereInput = { ...base, ...(status === "OPEN" ? { status: { notIn: ["SPAM", "RESOLVED"] } } : status === "RESOLVED" ? { status: "RESOLVED" } : {}), ...(assignee !== "ALL" ? { assignedToId: assignee === "QUEUE" ? null : assignee } : {}) };
  if (search) where.OR = [{ senderName: { contains: search, mode: "insensitive" } }, { subject: { contains: search, mode: "insensitive" } }, { client: { name: { contains: search, mode: "insensitive" } } }, { senderEmail: { contains: search, mode: "insensitive" } }];
  const pageSize = 50;
  const [groups, members, tickets, total] = await Promise.all([
    prisma.serviceTicket.groupBy({ by: ["assignedToId", "status"], where: base, _count: { _all: true } }),
    prisma.organizationMember.findMany({ where: { organizationId: member.organizationId, role: { not: "CLIENT" } }, select: { user: { select: { id: true, name: true, email: true } } } }),
    prisma.serviceTicket.findMany({ where, orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, subject: true, senderName: true, senderEmail: true, snippet: true, status: true, lastMessageAt: true, receivedAt: true, client: { select: { id: true, name: true } }, assignedTo: { select: { id: true, name: true, email: true } } } }),
    prisma.serviceTicket.count({ where }),
  ]);
  const people = members.map(item => item.user);
  const known = new Set(people.map(person => person.id));
  const formerIds = [...new Set(groups.map(group => group.assignedToId).filter((id): id is string => Boolean(id && !known.has(id))))];
  if (formerIds.length) people.push(...await prisma.user.findMany({ where: { id: { in: formerIds } }, select: { id: true, name: true, email: true } }));
  return NextResponse.json({ ...summarizeAssignments(groups, people), tickets, total, page, pageSize, updatedAt: new Date().toISOString() }, { headers: { "Cache-Control": "private, no-store" } });
}
