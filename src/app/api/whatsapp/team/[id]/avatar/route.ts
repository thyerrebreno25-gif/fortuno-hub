import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServiceCenterMember, getWhatsAppPermission } from "@/modules/atendimento/auth";
import { canViewWhatsAppManagement } from "@/modules/whatsapp/management-access";
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}) {
  const member=await getServiceCenterMember();
  if(!member||!canViewWhatsAppManagement(member.role,(await getWhatsAppPermission(member.organizationId,member.role)).canView))return new NextResponse(null,{status:403});
  const {id}=await params;
  const operator=await prisma.organizationMember.findFirst({where:{organizationId:member.organizationId,userId:id,role:{not:"CLIENT"}},select:{user:{select:{avatar:true}}}});
  const avatar=operator?.user.avatar,match=avatar&&/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(avatar);
  if(!match)return new NextResponse(null,{status:404});
  return new NextResponse(Buffer.from(match[2],"base64"),{headers:{"Content-Type":"image/"+match[1],"Cache-Control":"private, max-age=300","X-Content-Type-Options":"nosniff"}});
}
