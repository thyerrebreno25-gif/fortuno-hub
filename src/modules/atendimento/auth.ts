import { prisma } from "@/lib/prisma";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import {
  defaultPermission,
  type ModuleCode,
} from "@/modules/permissions/permissions";

export const SERVICE_CENTER_MANAGER_ROLES = new Set([
  "MASTER",
  "ADMIN",
  "MANAGER",
]);

export async function getServiceCenterMember() {
  const supabase = await createSupabaseClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;

  return prisma.organizationMember.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });
}

export async function getServiceCenterPermission(
  organizationId: string,
  role: string,
  moduleCode: ModuleCode = "SERVICE_CENTER",
) {
  if (role === "MASTER") {
    return {
      canView: true,
      canCreate: true,
      canEdit: true,
      canDelete: true,
      canImport: true,
      canExport: true,
      canManage: true,
    };
  }

  const stored = await prisma.roleModulePermission.findUnique({
    where: {
      organizationId_role_moduleCode: {
        organizationId,
        role: role as "ADMIN" | "MANAGER" | "OPERATOR" | "CLIENT",
        moduleCode,
      },
    },
  });

  if (stored) {
    return {
      canView: stored.canView,
      canCreate: stored.canCreate,
      canEdit: stored.canEdit,
      canDelete: stored.canDelete,
      canImport: stored.canImport,
      canExport: stored.canExport,
      canManage: stored.canManage,
    };
  }

  return defaultPermission(role, moduleCode);
}

export function getWhatsAppPermission(
  organizationId: string,
  role: string,
) {
  return getServiceCenterPermission(organizationId, role, "WHATSAPP");
}
