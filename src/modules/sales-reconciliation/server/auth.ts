import {
  getCurrentMember,
  getRolePermissions,
} from "@/modules/permissions/permissions";

export async function getSalesReconciliationAccess() {
  const member = await getCurrentMember();
  if (!member) return null;

  const permissions = await getRolePermissions(
    member.organizationId,
    member.role,
  );

  return {
    member,
    permission: permissions.SALES_RECONCILIATION,
  };
}
