import {NextResponse} from "next/server";
import {prisma} from "@/lib/prisma";
import {getServiceCenterMember,getWhatsAppPermission} from "@/modules/atendimento/auth";
import {currentWhatsAppAccount} from "@/modules/whatsapp/account-scope";
import {resolveWhatsappTicketId} from "@/modules/whatsapp/server";
import {findReplyTarget,ReplyTargetError} from "@/modules/whatsapp/reply-target";
export async function GET(_request:Request,context:{params:Promise<{id:string;messageId:string}>}){
 const member=await getServiceCenterMember();if(!member)return NextResponse.json({error:"Sessão inválida."},{status:401});
 const permission=await getWhatsAppPermission(member.organizationId,member.role);if(!permission.canView||member.role==="CLIENT")return NextResponse.json({error:"Sem permissão."},{status:403});
 try{
  const {id,messageId}=await context.params;if(id.length>100)throw new ReplyTargetError("Conversa inválida.");
  const account=await currentWhatsAppAccount(member.organizationId),canonicalId=await resolveWhatsappTicketId(id,member.organizationId);
  const current=await prisma.serviceTicket.findFirst({where:{id:canonicalId,...account.where,mergedIntoId:null,isSpam:false},select:{id:true,organizationId:true,senderEmail:true,recipientEmail:true,createdAt:true}});
  if(!current)throw new ReplyTargetError("Conversa não encontrada.",404);
  const target=await findReplyTarget(current,messageId,account);
  return NextResponse.json({message:target.message},{headers:{"Cache-Control":"private, no-store"}});
 }catch(error){return NextResponse.json({error:error instanceof ReplyTargetError?error.message:"Não foi possível abrir a mensagem original."},{status:error instanceof ReplyTargetError?error.status:500});}
}

export async function PATCH(request:Request,context:{params:Promise<{id:string;messageId:string}>}){const {mutateWhatsAppMessage}=await import("@/modules/whatsapp/message-mutations");const {id,messageId}=await context.params;return mutateWhatsAppMessage(request,id,messageId,"edit");}
export async function DELETE(request:Request,context:{params:Promise<{id:string;messageId:string}>}){const {mutateWhatsAppMessage}=await import("@/modules/whatsapp/message-mutations");const {id,messageId}=await context.params;return mutateWhatsAppMessage(request,id,messageId,"delete");}
