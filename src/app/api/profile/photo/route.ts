import {NextResponse} from "next/server";
import {prisma} from "@/lib/prisma";
import {getSettingsMember,SETTINGS_ADMIN_ROLES} from "@/modules/settings/server/settings-auth";
import {validAvatar} from "@/modules/profile/avatar";
export async function POST(request:Request){
 const current=await getSettingsMember();if(!current)return NextResponse.json({error:"Sessão inválida."},{status:401});
 const body=await request.json().catch(()=>null);if(!body||!validAvatar(body.avatar))return NextResponse.json({error:"Envie uma foto JPEG recortada de até 130 KB."},{status:400});
 const memberId=typeof body.memberId==="string"?body.memberId:current.id;
 if(memberId!==current.id&&!SETTINGS_ADMIN_ROLES.has(current.role))return NextResponse.json({error:"Sem permissão para alterar a foto deste perfil."},{status:403});
 const target=await prisma.organizationMember.findFirst({where:{id:memberId,organizationId:current.organizationId},select:{userId:true}});
 if(!target)return NextResponse.json({error:"Perfil não encontrado nesta organização."},{status:404});
 await prisma.$transaction(async tx=>{await tx.user.update({where:{id:target.userId},data:{avatar:body.avatar}});await tx.auditLog.create({data:{userId:current.userId,action:"UPDATE_PROFILE_PHOTO",entity:"User",entityId:target.userId,afterData:{photoUpdated:true}}});});
 return NextResponse.json({ok:true});
}
