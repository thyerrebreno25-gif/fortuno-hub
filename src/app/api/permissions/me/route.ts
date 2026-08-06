import { NextResponse } from "next/server";
import { getCurrentMember, getRolePermissions } from "@/modules/permissions/permissions";
export async function GET(){
  const member=await getCurrentMember();
  if(!member) return NextResponse.json({error:"Sessão inválida."},{status:401});
  return NextResponse.json({role:member.role,permissions:await getRolePermissions(member.organizationId,member.role)});
}
