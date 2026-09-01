import { prisma } from "@/lib/prisma";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getRolePermissions, type ModuleCode, type PermissionShape } from "@/modules/permissions/permissions";

export type PurchaseInvoiceMember = {
  id: string;
  userId: string;
  organizationId: string;
  role: string;
};

export async function getPurchaseInvoiceMember(): Promise<PurchaseInvoiceMember | null> {
  const supabase = await createSupabaseClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;

  return prisma.organizationMember.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, userId: true, organizationId: true, role: true },
  });
}
export async function getPurchaseInvoicePermission(
  member: PurchaseInvoiceMember,
): Promise<PermissionShape> {
  const permissions = await getRolePermissions(member.organizationId, member.role);
  return permissions["PURCHASE_INVOICES" as ModuleCode];
}

export async function findAuthorizedClient(member: PurchaseInvoiceMember, clientId: string) {
  return prisma.client.findFirst({
    where: { id: clientId, organizationId: member.organizationId, active: true },
    select: { id: true, name: true, document: true },
  });
}
