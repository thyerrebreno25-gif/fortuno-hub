import "server-only";
import {prisma} from "@/lib/prisma";
import {getServiceCenterMember,getWhatsAppPermission} from "@/modules/atendimento/auth";
import {currentWhatsAppAccount} from "./account-scope";
export class WhatsAppSendError extends Error { constructor(message:string,public status=400){super(message);} }
export async function whatsappSendAccess(id:string) {
  if(!id||id.length>100)throw new WhatsAppSendError("Conversa inválida.");
  const member=await getServiceCenterMember();
  if(!member)throw new WhatsAppSendError("Sessão inválida.",401);
  const permission=await getWhatsAppPermission(member.organizationId,member.role);
  if(!permission.canEdit||member.role==="CLIENT")throw new WhatsAppSendError("Sem permissão.",403);
  const account=await currentWhatsAppAccount(member.organizationId);
  const ticket=await prisma.serviceTicket.findFirst({where:{id,...account.where,mergedIntoId:null,isSpam:false},select:{id:true,organizationId:true,senderEmail:true,recipientEmail:true,assignedToId:true,status:true,createdAt:true}});
  if(!ticket||!account.recipient||!account.connection?.phone)throw new WhatsAppSendError("Conversa indisponível na conta conectada.",404);
  if(ticket.assignedToId!==member.userId)throw new WhatsAppSendError("Assuma este chamado antes de enviar ao cliente.",403);
  if(["RESOLVED","SPAM"].includes(ticket.status))throw new WhatsAppSendError("O atendimento foi finalizado. Aguarde uma nova mensagem do cliente.",409);
  return {member,ticket,account};
}
