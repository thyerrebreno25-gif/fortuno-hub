import { prisma } from "@/lib/prisma";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export const MODULE_CODES = [
  "DASHBOARD","NOTICES","ASSISTANT","CLIENTS","IMPORTS","PURCHASE_INVOICES","SALES_RECONCILIATION","OPERATIONS","SERVICE_CENTER","WHATSAPP","OPERATIONAL_MAPPING","AUDIT","ONBOARDING","REPORTS","SUPPORT","SETTINGS","MOTOR_EXCHANGE","HISTORY"
] as const;
export type ModuleCode = (typeof MODULE_CODES)[number];
export type PermissionShape = { canView:boolean; canCreate:boolean; canEdit:boolean; canDelete:boolean; canImport:boolean; canExport:boolean; canManage:boolean };

const full: PermissionShape = {canView:true,canCreate:true,canEdit:true,canDelete:true,canImport:true,canExport:true,canManage:true};
const none: PermissionShape = {canView:false,canCreate:false,canEdit:false,canDelete:false,canImport:false,canExport:false,canManage:false};

export function defaultPermission(role:string,module:ModuleCode): PermissionShape {
  if(role === "MASTER" || role === "ADMIN") return full;
  if(role === "MANAGER") return module === "SETTINGS" ? {...full,canDelete:false} : full;
  if(role === "OPERATOR") {
    if(module === "DASHBOARD") return {...none,canView:true};
    if(module === "NOTICES") return {...none,canView:true,canCreate:true,canEdit:true,canDelete:true};
    if(module === "ASSISTANT") return {...none,canView:true,canCreate:true,canEdit:true,canDelete:true};
    if(module === "OPERATIONAL_MAPPING") return {...none,canView:true,canCreate:true,canEdit:true};
    if(module === "CLIENTS") return {...none,canView:true,canCreate:true,canEdit:true};
    if(module === "PURCHASE_INVOICES") return {...none,canView:true,canCreate:true,canEdit:true,canImport:true,canExport:true};
    if(module === "AUDIT") return {...none,canView:true,canEdit:true};
    if(module === "SERVICE_CENTER") return {...none,canView:true,canCreate:true,canEdit:true};
    return none;
  }
  if(role === "CLIENT") {
    if(module === "DASHBOARD" || module === "SUPPORT") return {...none,canView:true,canCreate:module === "SUPPORT"};
    return none;
  }
  return none;
}

export async function getCurrentMember(){
  const supabase = await createSupabaseClient();
  const {data:{user}} = await supabase.auth.getUser();
  if(!user) return null;
  return prisma.organizationMember.findFirst({where:{userId:user.id},orderBy:{createdAt:"asc"},select:{id:true,userId:true,organizationId:true,role:true,isTeamLeader:true}});
}

export async function getRolePermissions(organizationId:string, role:string){
  const rows = await prisma.roleModulePermission.findMany({where:{organizationId,role:role as never}});
  const by = new Map(rows.map(r=>[r.moduleCode,r]));
  return Object.fromEntries(MODULE_CODES.map(module=>{
    const row = by.get(module);
    return [module,row ? {canView:row.canView,canCreate:row.canCreate,canEdit:row.canEdit,canDelete:row.canDelete,canImport:row.canImport,canExport:row.canExport,canManage:row.canManage} : defaultPermission(role,module)];
  })) as Record<ModuleCode,PermissionShape>;
}
