import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentMember, getRolePermissions, MODULE_CODES } from "@/modules/permissions/permissions";
const ADMIN=new Set(["MASTER","ADMIN"]);
const ROLES=["MASTER","ADMIN","MANAGER","OPERATOR","CLIENT"] as const;
export async function GET(){
  const m=await getCurrentMember(); if(!m) return NextResponse.json({error:"Sessão inválida."},{status:401});
  if(!ADMIN.has(m.role)) return NextResponse.json({error:"Sem permissão."},{status:403});
  const roles=Object.fromEntries(await Promise.all(ROLES.map(async r=>[r,await getRolePermissions(m.organizationId,r)])));
  return NextResponse.json({roles});
}
export async function PUT(request:Request){
  const m=await getCurrentMember(); if(!m) return NextResponse.json({error:"Sessão inválida."},{status:401});
  if(!ADMIN.has(m.role)) return NextResponse.json({error:"Sem permissão."},{status:403});
  const body=await request.json() as {role?:string; permissions?:Record<string,any>};
  if(!body.role || !ROLES.includes(body.role as any) || !body.permissions) return NextResponse.json({error:"Dados inválidos."},{status:400});
  if(body.role === "MASTER") return NextResponse.json({error:"O perfil Master permanece com acesso total."},{status:400});
  await prisma.$transaction(MODULE_CODES.map(module=>{
    const p=body.permissions![module] ?? {};
    return prisma.roleModulePermission.upsert({
      where:{organizationId_role_moduleCode:{organizationId:m.organizationId,role:body.role as never,moduleCode:module}},
      create:{organizationId:m.organizationId,role:body.role as never,moduleCode:module,canView:!!p.canView,canCreate:!!p.canCreate,canEdit:!!p.canEdit,canDelete:!!p.canDelete,canImport:!!p.canImport,canExport:!!p.canExport,canManage:!!p.canManage},
      update:{canView:!!p.canView,canCreate:!!p.canCreate,canEdit:!!p.canEdit,canDelete:!!p.canDelete,canImport:!!p.canImport,canExport:!!p.canExport,canManage:!!p.canManage}
    });
  }));
  return NextResponse.json({message:"Permissões salvas com sucesso."});
}
