import {NextResponse} from "next/server";
import {Prisma} from "@/generated/prisma/client";
import {prisma} from "@/lib/prisma";
import {getServiceCenterMember,getWhatsAppPermission,SERVICE_CENTER_MANAGER_ROLES} from "@/modules/atendimento/auth";
import {currentWhatsAppAccount} from "@/modules/whatsapp/account-scope";
import {listPaymentRequests} from "@/modules/whatsapp/payment-requests";
async function access(){const member=await getServiceCenterMember();if(!member)return null;const permission=await getWhatsAppPermission(member.organizationId,member.role);return member.role!=="CLIENT"&&permission.canView?{member,permission,manager:SERVICE_CENTER_MANAGER_ROLES.has(member.role)}:null;}
export async function GET(request:Request){const auth=await access();if(!auth)return NextResponse.json({error:"Sem acesso."},{status:403});const scope=new URL(request.url).searchParams.get("scope")==="ALL"?"ALL":"PENDING";const rows=await listPaymentRequests(auth.member.organizationId,auth.member.userId,auth.manager,scope,200);return NextResponse.json({rows:rows.map(row=>({...row,canCreate:auth.permission.canEdit&&row.assignedToId===auth.member.userId&&!["RESOLVED","SPAM"].includes(row.ticketStatus),canCheck:auth.permission.canEdit&&(auth.manager||row.assignedToId===auth.member.userId)}))},{headers:{"Cache-Control":"private, no-store"}});}
export async function PATCH(request:Request){
 const auth=await access();if(!auth||!auth.permission.canEdit)return NextResponse.json({error:"Sem permissão."},{status:403});
 const input=await request.json().catch(()=>null);if(!input||typeof input.messageId!=="string"||input.messageId.length>100||!["REVIEWED","IGNORED"].includes(input.action))return NextResponse.json({error:"Escolha uma solicitação válida."},{status:400});
 const account=await currentWhatsAppAccount(auth.member.organizationId);if(!account.recipient)return NextResponse.json({error:"Conexão indisponível."},{status:409});
 const changed=await prisma.$transaction(async tx=>{
  const rows=await tx.$queryRaw<Array<{ticketId:string}>>(Prisma.sql`UPDATE "WhatsAppPaymentRequest" p SET status=${input.action},"checkedById"=${auth.member.userId},"checkedAt"=CURRENT_TIMESTAMP FROM "ServiceMessage" m,"ServiceTicket" t WHERE p."messageId"=${input.messageId} AND p.status='PENDING' AND p."organizationId"=${auth.member.organizationId} AND p."accountRecipient"=${account.recipient} AND m.id=p."messageId" AND t.id=m."ticketId" AND t."organizationId"=${auth.member.organizationId} AND t."recipientEmail"=${account.recipient} AND t."mergedIntoId" IS NULL AND (${auth.manager} OR t."assignedToId"=${auth.member.userId}) RETURNING t.id AS "ticketId"`);
  if(rows[0])await tx.serviceTicketHistory.create({data:{ticketId:rows[0].ticketId,userId:auth.member.userId,type:"WHATSAPP_PAYMENT_CHECKED",message:input.action==="REVIEWED"?"Possível solicitação de pagamento conferida pelo operador.":"Alerta conferido: não se trata de uma solicitação de pagamento.",metadata:{messageId:input.messageId,action:input.action}}});return rows.length;
 });return changed?NextResponse.json({ok:true}):NextResponse.json({error:"Solicitação indisponível ou já conferida."},{status:409});
}
