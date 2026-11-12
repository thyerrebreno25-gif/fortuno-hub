import {NextResponse} from "next/server";
import {Prisma} from "@/generated/prisma/client";
import {prisma} from "@/lib/prisma";
import {getServiceCenterMember,getWhatsAppPermission} from "@/modules/atendimento/auth";
import {canViewWhatsAppManagement} from "@/modules/whatsapp/management-access";
import {currentWhatsAppAccount} from "@/modules/whatsapp/account-scope";
export async function GET(){
 const member=await getServiceCenterMember();if(!member)return NextResponse.json({error:"Sessão inválida."},{status:401});
 const permission=await getWhatsAppPermission(member.organizationId,member.role);if(!canViewWhatsAppManagement(member.role,permission.canView))return NextResponse.json({error:"Acesso restrito à gestão."},{status:403});
 const account=await currentWhatsAppAccount(member.organizationId);if(!account.recipient||!account.connection?.phone)return NextResponse.json({error:"Conecte o WhatsApp para verificar os grupos desta conta."},{status:409});
 const groups=await prisma.$queryRaw<Array<{identifier:string;name:string;closed:number;open:number;messages:number;emptyClosed:number}>>(Prisma.sql`
 WITH per_ticket AS (
  SELECT t.id,t."senderEmail",t."senderName",t.subject,t.status,t."lastMessageAt",COUNT(m.id)::int AS messages
  FROM "ServiceTicket" t LEFT JOIN "ServiceMessage" m ON m."ticketId"=t.id
  WHERE t."organizationId"=${member.organizationId} AND t.source='WHATSAPP_API' AND t."recipientEmail"=${account.recipient}
   AND t."senderEmail" LIKE 'wa-group:%' AND t."mergedIntoId" IS NULL AND t."isSpam"=false AND t.status::text<>'SPAM'
  GROUP BY t.id
 ) SELECT "senderEmail" AS identifier,(array_agg(COALESCE("senderName",subject) ORDER BY "lastMessageAt" DESC,id DESC))[1] AS name,
 COUNT(*) FILTER(WHERE status::text='RESOLVED')::int AS closed,COUNT(*) FILTER(WHERE status::text<>'RESOLVED')::int AS open,
 COALESCE(SUM(messages) FILTER(WHERE status::text='RESOLVED'),0)::int AS messages,
 COUNT(*) FILTER(WHERE status::text='RESOLVED' AND messages=0)::int AS "emptyClosed"
 FROM per_ticket GROUP BY "senderEmail" HAVING COUNT(*) FILTER(WHERE status::text='RESOLVED')>1
 ORDER BY closed DESC,name ASC
 `);
 return NextResponse.json({groups,updatedAt:new Date().toISOString()},{headers:{"Cache-Control":"private, no-store"}});
}
