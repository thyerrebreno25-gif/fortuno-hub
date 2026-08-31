export const NOTICE_MANAGER_ROLES = new Set(["MASTER", "ADMIN", "MANAGER"]);

export function canManageNotices(member: {
  role: string;
  isTeamLeader: boolean;
}) {
  return NOTICE_MANAGER_ROLES.has(member.role) || member.isTeamLeader;
}

export function canBroadcastToOrganization(member: { role: string }) {
  return NOTICE_MANAGER_ROLES.has(member.role);
}
