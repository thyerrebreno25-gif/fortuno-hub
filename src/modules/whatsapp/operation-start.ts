import "server-only";
import {prisma} from "@/lib/prisma";
export async function operationStartedAt(organizationId:string,accountRecipient?:string|null){
  const row=await prisma.whatsAppOperationStart.findFirst({where:{organizationId,...(accountRecipient?{accountRecipient}:{})},orderBy:{startedAt:"desc"},select:{startedAt:true}});
  return row?.startedAt||null;
}
