import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getRolePermissions } from "@/modules/permissions/permissions";
import {
  canBroadcastToOrganization,
  canManageNotices,
  getNoticeMember,
} from "@/modules/notices/server/notice-auth";

const VALID_KINDS = new Set(["ALERT", "REMINDER", "NOTE"]);
const VALID_SCOPES = new Set(["PERSONAL", "CLIENTS", "GENERAL"]);
const VALID_PRIORITIES = new Set(["LOW", "NORMAL", "HIGH", "CRITICAL"]);

function parseDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function serializeNotice(
  notice: Prisma.NoticeGetPayload<{
    include: {
      author: { include: { user: true } };
      clients: { include: { client: true } };
      recipients: { include: { member: { include: { user: true } } } };
    };
  }>,
  currentMemberId: string,
) {
  const currentRecipient = notice.recipients.find(
    (recipient) => recipient.memberId === currentMemberId,
  );
  const viewed = notice.recipients.filter((recipient) => recipient.viewedAt).length;
  const completed = notice.recipients.filter(
    (recipient) => recipient.completedAt,
  ).length;

  return {
    id: notice.id,
    kind: notice.kind,
    scope: notice.scope,
    priority: notice.priority,
    title: notice.title,
    body: notice.body,
    targetsAllClients: notice.targetsAllClients,
    dueAt: notice.dueAt,
    expiresAt: notice.expiresAt,
    closedAt: notice.closedAt,
    createdAt: notice.createdAt,
    updatedAt: notice.updatedAt,
    author: {
      id: notice.author.id,
      name: notice.author.user.name || notice.author.user.email,
      email: notice.author.user.email,
    },
    clients: notice.clients.map(({ client }) => ({
      id: client.id,
      name: client.name,
    })),
    mine: currentRecipient
      ? {
          viewedAt: currentRecipient.viewedAt,
          completedAt: currentRecipient.completedAt,
        }
      : null,
    audience: {
      total: notice.recipients.length,
      viewed,
      pendingView: notice.recipients.length - viewed,
      completed,
      pendingCompletion: notice.recipients.length - completed,
      recipients: notice.recipients.map((recipient) => ({
        memberId: recipient.memberId,
        name: recipient.member.user.name || recipient.member.user.email,
        email: recipient.member.user.email,
        viewedAt: recipient.viewedAt,
        completedAt: recipient.completedAt,
      })),
    },
  };
}

export async function GET(request: Request) {
  const member = await getNoticeMember();
  if (!member) {
    return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  }
  const permissions = await getRolePermissions(member.organizationId, member.role);
  if (!permissions.NOTICES.canView) {
    return NextResponse.json(
      { error: "Você não possui permissão para visualizar avisos." },
      { status: 403 },
    );
  }

  const url = new URL(request.url);
  const view = url.searchParams.get("view") || "inbox";
  const now = new Date();

  if (view === "options") {
    const canManage = canManageNotices(member) && permissions.NOTICES.canManage;
    const clients = canManage
      ? await prisma.client.findMany({
          where: { organizationId: member.organizationId, active: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true, document: true },
        })
      : [];

    return NextResponse.json({
      member: {
        id: member.id,
        role: member.role,
        isTeamLeader: member.isTeamLeader,
        name: member.user.name || member.user.email,
      },
      capabilities: {
        canManage,
        canBroadcastOrganization:
          canBroadcastToOrganization(member) && permissions.NOTICES.canManage,
      },
      clients,
    });
  }

  const include = {
    author: { include: { user: true } },
    clients: { include: { client: true } },
    recipients: { include: { member: { include: { user: true } } } },
  } satisfies Prisma.NoticeInclude;

  if (view === "management") {
    if (!canManageNotices(member) || !permissions.NOTICES.canManage) {
      return NextResponse.json(
        { error: "Você não possui permissão para acompanhar avisos gerais." },
        { status: 403 },
      );
    }

    const teamMemberIds = member.isTeamLeader
      ? (
          await prisma.organizationMember.findMany({
            where: {
              organizationId: member.organizationId,
              OR: [{ id: member.id }, { teamLeaderId: member.id }],
            },
            select: { id: true },
          })
        ).map((item) => item.id)
      : [];

    const managementRestriction: Prisma.NoticeWhereInput =
      canBroadcastToOrganization(member)
        ? {}
        : {
            OR: [
              { authorMemberId: member.id },
              { recipients: { some: { memberId: { in: teamMemberIds } } } },
            ],
          };

    const notices = await prisma.notice.findMany({
      where: {
        organizationId: member.organizationId,
        scope: { not: "PERSONAL" },
        ...managementRestriction,
      },
      include,
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    const visibleNotices = canBroadcastToOrganization(member)
      ? notices
      : notices.map((notice) => ({
          ...notice,
          recipients: notice.recipients.filter((recipient) =>
            teamMemberIds.includes(recipient.memberId),
          ),
        }));

    return NextResponse.json({
      notices: visibleNotices.map((notice) => serializeNotice(notice, member.id)),
    });
  }

  const status = url.searchParams.get("status") || "active";
  const limit = Math.min(
    Math.max(Number.parseInt(url.searchParams.get("limit") || "50", 10) || 50, 1),
    100,
  );
  const recipientCondition: Prisma.NoticeRecipientWhereInput = {
    memberId: member.id,
  };
  const noticeCondition: Prisma.NoticeWhereInput = {
    organizationId: member.organizationId,
  };

  if (status === "completed") {
    recipientCondition.completedAt = { not: null };
  } else if (status === "expired") {
    noticeCondition.closedAt = null;
    noticeCondition.expiresAt = { lt: now };
  } else {
    recipientCondition.completedAt = null;
    noticeCondition.closedAt = null;
    noticeCondition.OR = [{ expiresAt: null }, { expiresAt: { gte: now } }];
  }

  const notices = await prisma.notice.findMany({
    where: {
      ...noticeCondition,
      recipients: { some: recipientCondition },
    },
    include,
    orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
    take: limit,
  });

  const priorityRank = { CRITICAL: 0, HIGH: 1, NORMAL: 2, LOW: 3 } as const;
  notices.sort((left, right) => {
    const priority = priorityRank[left.priority] - priorityRank[right.priority];
    if (priority !== 0) return priority;
    return (left.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
      (right.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER);
  });

  return NextResponse.json({
    notices: notices.map((notice) => serializeNotice(notice, member.id)),
  });
}

export async function POST(request: Request) {
  const member = await getNoticeMember();
  if (!member) {
    return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  }
  const permissions = await getRolePermissions(member.organizationId, member.role);
  if (!permissions.NOTICES.canCreate) {
    return NextResponse.json(
      { error: "Você não possui permissão para criar avisos." },
      { status: 403 },
    );
  }

  const body = (await request.json()) as Record<string, unknown>;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.body === "string" ? body.body.trim() : "";
  const kind = typeof body.kind === "string" && VALID_KINDS.has(body.kind)
    ? body.kind
    : "ALERT";
  const scope = typeof body.scope === "string" && VALID_SCOPES.has(body.scope)
    ? body.scope
    : "PERSONAL";
  const priority =
    typeof body.priority === "string" && VALID_PRIORITIES.has(body.priority)
      ? body.priority
      : "NORMAL";
  const dueAt = parseDate(body.dueAt);
  const expiresAt = parseDate(body.expiresAt);
  const allClients = body.allClients === true;
  const requestedClientIds = Array.isArray(body.clientIds)
    ? [...new Set(body.clientIds.filter((id): id is string => typeof id === "string"))]
    : [];

  if (title.length < 3 || title.length > 120) {
    return NextResponse.json(
      { error: "O título deve ter entre 3 e 120 caracteres." },
      { status: 400 },
    );
  }
  if (description.length > 3000) {
    return NextResponse.json(
      { error: "A descrição deve ter no máximo 3.000 caracteres." },
      { status: 400 },
    );
  }
  if (
    scope !== "PERSONAL" &&
    (!canManageNotices(member) || !permissions.NOTICES.canManage)
  ) {
    return NextResponse.json(
      { error: "Seu perfil pode criar somente lembretes e notas pessoais." },
      { status: 403 },
    );
  }
  if ((kind === "ALERT" || kind === "REMINDER") && !expiresAt) {
    return NextResponse.json(
      { error: "Defina até quando o aviso ficará ativo." },
      { status: 400 },
    );
  }
  if (expiresAt && expiresAt <= new Date()) {
    return NextResponse.json(
      { error: "A expiração precisa estar no futuro." },
      { status: 400 },
    );
  }
  if (dueAt && expiresAt && dueAt > expiresAt) {
    return NextResponse.json(
      { error: "O prazo de execução não pode ser posterior à expiração." },
      { status: 400 },
    );
  }
  if (
    scope === "GENERAL" &&
    (!canManageNotices(member) || !permissions.NOTICES.canManage)
  ) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }
  if (scope === "CLIENTS" && !allClients && requestedClientIds.length === 0) {
    return NextResponse.json(
      { error: "Selecione ao menos um cliente." },
      { status: 400 },
    );
  }

  let clients: Array<{
    id: string;
    operationLeaderId: string | null;
    payableResponsibleId: string | null;
    receivableResponsibleId: string | null;
    generalResponsibleId: string | null;
  }> = [];

  if (scope === "CLIENTS") {
    clients = await prisma.client.findMany({
      where: {
        organizationId: member.organizationId,
        active: true,
        ...(allClients ? {} : { id: { in: requestedClientIds } }),
      },
      select: {
        id: true,
        operationLeaderId: true,
        payableResponsibleId: true,
        receivableResponsibleId: true,
        generalResponsibleId: true,
      },
    });

    if (!allClients && clients.length !== requestedClientIds.length) {
      return NextResponse.json(
        { error: "Um ou mais clientes selecionados são inválidos." },
        { status: 400 },
      );
    }
  }

  const recipientIds = new Set<string>([member.id]);

  if (scope === "GENERAL") {
    const recipientMembers = await prisma.organizationMember.findMany({
      where: canBroadcastToOrganization(member)
        ? { organizationId: member.organizationId }
        : {
            organizationId: member.organizationId,
            OR: [{ id: member.id }, { teamLeaderId: member.id }],
          },
      select: { id: true },
    });
    recipientMembers.forEach((recipient) => recipientIds.add(recipient.id));
  }

  if (scope === "CLIENTS") {
    const responsibleUserIds = new Set<string>();
    clients.forEach((client) => {
      [
        client.operationLeaderId,
        client.payableResponsibleId,
        client.receivableResponsibleId,
        client.generalResponsibleId,
      ].forEach((userId) => {
        if (userId) responsibleUserIds.add(userId);
      });
    });

    if (responsibleUserIds.size > 0) {
      const responsibleMembers = await prisma.organizationMember.findMany({
        where: {
          organizationId: member.organizationId,
          userId: { in: [...responsibleUserIds] },
        },
        select: { id: true, teamLeaderId: true },
      });
      responsibleMembers.forEach((responsible) => {
        recipientIds.add(responsible.id);
        if (responsible.teamLeaderId) recipientIds.add(responsible.teamLeaderId);
      });
    }
  }

  const notice = await prisma.notice.create({
    data: {
      organizationId: member.organizationId,
      authorMemberId: member.id,
      kind: kind as "ALERT" | "REMINDER" | "NOTE",
      scope: scope as "PERSONAL" | "CLIENTS" | "GENERAL",
      priority: priority as "LOW" | "NORMAL" | "HIGH" | "CRITICAL",
      title,
      body: description || null,
      targetsAllClients: scope === "CLIENTS" && allClients,
      dueAt,
      expiresAt,
      clients: {
        create: clients.map((client) => ({ clientId: client.id })),
      },
      recipients: {
        create: [...recipientIds].map((memberId) => ({ memberId })),
      },
    },
    include: {
      author: { include: { user: true } },
      clients: { include: { client: true } },
      recipients: { include: { member: { include: { user: true } } } },
    },
  });

  return NextResponse.json(
    { notice: serializeNotice(notice, member.id) },
    { status: 201 },
  );
}
