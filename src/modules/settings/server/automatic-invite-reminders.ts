import "server-only";

import { prisma } from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  deliverMemberInvite,
  isMemberAccessActivated,
  type MemberInviteRole,
} from "@/modules/settings/server/member-invite-delivery";

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const MAX_AUTOMATIC_REMINDERS = 3;
const MAX_REMINDERS_PER_RUN = 15;

const INVITE_AUDIT_ACTIONS = [
  "ORGANIZATION_MEMBER_INVITED",
  "ORGANIZATION_MEMBER_INVITE_RESENT",
  "ORGANIZATION_MEMBER_INVITE_AUTO_RESENT",
];

type InviteAuditState = {
  automaticCount: number;
  latestSentAt: Date | null;
};

export async function sendAutomaticPendingInviteReminders(now = new Date()) {
  const admin = createAdminClient();

  if (!admin) {
    throw new Error("Supabase administrativo não configurado.");
  }

  const resendCutoff = new Date(now.getTime() - DAY_IN_MS);
  const members = await prisma.organizationMember.findMany({
    where: {
      role: { not: "MASTER" },
      createdAt: { lte: resendCutoff },
    },
    orderBy: { createdAt: "asc" },
    take: 500,
    select: {
      id: true,
      organizationId: true,
      role: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  const { data: authData, error: authError } =
    await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });

  if (authError) {
    throw authError;
  }

  const authUsers = new Map(
    authData.users.map((authUser) => [authUser.id, authUser]),
  );
  const pendingMembers = members.filter((member) => {
    const authUser = authUsers.get(member.user.id);
    return authUser && !isMemberAccessActivated(authUser);
  });

  if (pendingMembers.length === 0) {
    return {
      considered: members.length,
      pending: 0,
      eligible: 0,
      sent: 0,
      failed: 0,
      limitPerMember: MAX_AUTOMATIC_REMINDERS,
    };
  }

  const memberIds = pendingMembers.map((member) => member.id);
  const organizationIds = [
    ...new Set(pendingMembers.map((member) => member.organizationId)),
  ];
  const [inviteAudits, administrators] = await Promise.all([
    prisma.auditLog.findMany({
      where: {
        entity: "OrganizationMember",
        entityId: { in: memberIds },
        action: { in: INVITE_AUDIT_ACTIONS },
      },
      orderBy: { createdAt: "asc" },
      select: {
        entityId: true,
        action: true,
        createdAt: true,
      },
    }),
    prisma.organizationMember.findMany({
      where: {
        organizationId: { in: organizationIds },
        role: { in: ["MASTER", "ADMIN"] },
      },
      orderBy: { createdAt: "asc" },
      select: {
        organizationId: true,
        role: true,
        userId: true,
      },
    }),
  ]);

  const auditByMember = new Map<string, InviteAuditState>();

  for (const audit of inviteAudits) {
    if (!audit.entityId) continue;

    const state = auditByMember.get(audit.entityId) || {
      automaticCount: 0,
      latestSentAt: null,
    };

    if (audit.action === "ORGANIZATION_MEMBER_INVITE_AUTO_RESENT") {
      state.automaticCount += 1;
    }

    if (!state.latestSentAt || audit.createdAt > state.latestSentAt) {
      state.latestSentAt = audit.createdAt;
    }

    auditByMember.set(audit.entityId, state);
  }

  const auditActorByOrganization = new Map<
    string,
    { role: string; userId: string }
  >();

  for (const administrator of administrators) {
    const existing = auditActorByOrganization.get(
      administrator.organizationId,
    );

    if (
      !existing ||
      (existing.role !== "MASTER" && administrator.role === "MASTER")
    ) {
      auditActorByOrganization.set(administrator.organizationId, {
        role: administrator.role,
        userId: administrator.userId,
      });
    }
  }

  const eligible = pendingMembers
    .filter((member) => {
      const audit = auditByMember.get(member.id);
      const latestSentAt = audit?.latestSentAt || member.createdAt;

      return (
        (audit?.automaticCount || 0) < MAX_AUTOMATIC_REMINDERS &&
        latestSentAt <= resendCutoff &&
        auditActorByOrganization.has(member.organizationId)
      );
    })
    .slice(0, MAX_REMINDERS_PER_RUN);

  let sent = 0;
  let failed = 0;

  for (const member of eligible) {
    const actor = auditActorByOrganization.get(member.organizationId);
    const audit = auditByMember.get(member.id);
    const attempt = (audit?.automaticCount || 0) + 1;
    const email = member.user.email.trim().toLowerCase();
    const name = member.user.name || member.user.email;

    if (!actor) continue;

    try {
      const delivery = await deliverMemberInvite({
        memberId: member.id,
        email,
        name,
        role: member.role as MemberInviteRole,
        reminder: true,
      });

      if (!delivery.sent) {
        failed += 1;
        console.error("Falha no lembrete automático de convite:", {
          memberId: member.id,
          reason: delivery.reason,
        });
        continue;
      }

      await prisma.auditLog.create({
        data: {
          userId: actor.userId,
          action: "ORGANIZATION_MEMBER_INVITE_AUTO_RESENT",
          entity: "OrganizationMember",
          entityId: member.id,
          afterData: {
            name,
            email,
            role: member.role,
            delivery: "PERMANENT_CUSTOM_INVITE",
            linkType: delivery.linkType,
            emailId: delivery.emailId || null,
            automatic: true,
            attempt,
            maxAttempts: MAX_AUTOMATIC_REMINDERS,
          },
        },
      });

      sent += 1;
    } catch (error) {
      failed += 1;
      console.error("Erro no lembrete automático de convite:", {
        memberId: member.id,
        error,
      });
    }
  }

  return {
    considered: members.length,
    pending: pendingMembers.length,
    eligible: eligible.length,
    sent,
    failed,
    limitPerMember: MAX_AUTOMATIC_REMINDERS,
  };
}
