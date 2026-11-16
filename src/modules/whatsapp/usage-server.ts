import "server-only";
import {unstable_cache} from "next/cache";
import {Prisma} from "@/generated/prisma/client";
import {prisma} from "@/lib/prisma";
import {whatsappUsageReport} from "./usage";
export async function whatsappUsage(org:string,recipient:string,phone:string,start:Date,end:Date){
 return unstable_cache(async()=>{
 const [counts,members]=await Promise.all([
 prisma.$queryRaw<Array<{userId:string;messages:number;comments:number;actions:number;conversations:number;clients:number;activeDays:number;lastAt:Date|null}>>(Prisma.sql`
 WITH events AS (
 SELECT h.id,h."userId",h.type,h.metadata,h."createdAt",t."clientId",t.id AS "ticketId"
 FROM "ServiceTicketHistory" h JOIN "ServiceTicket" t ON t.id=h."ticketId"
 LEFT JOIN "WhatsAppOperationStart" b ON b."organizationId"=t."organizationId" AND b."accountRecipient"=t."recipientEmail"
 WHERE t."organizationId"=${org} AND t.source='WHATSAPP_API' AND t."recipientEmail"=${recipient} AND t."isSpam"=false AND t.status::text<>'SPAM'
 AND h."userId" IS NOT NULL AND h."createdAt">=${start} AND h."createdAt"<${end} AND (b."startedAt" IS NULL OR h."createdAt">=b."startedAt")
 AND (h.type IN ('WHATSAPP_REPLIED','WHATSAPP_COMMENTED','WHATSAPP_TRANSFERRED','WHATSAPP_RESOLVED','WHATSAPP_ASSIGNED','WHATSAPP_REOPENED') OR h.type IN ('WHATSAPP_MEDIA_UPLOAD','WHATSAPP_FORWARDED') AND h.metadata->>'state'='SENT')
 AND (h.type<>'WHATSAPP_REPLIED' OR NOT EXISTS(SELECT 1 FROM "ServiceMessage" m WHERE m."ticketId"=t.id AND m."externalMessageId"=h.metadata->>'externalMessageId' AND m."deliveryStatus" IN ('failed','unconfirmed') AND (m."providerMetadata"->>'accountPhone'=${phone} OR m."externalMessageId" LIKE ${`uazapi:${phone}:%`})))
 ) SELECT "userId",COUNT(*)::int AS actions,COUNT(*) FILTER(WHERE type IN ('WHATSAPP_REPLIED','WHATSAPP_MEDIA_UPLOAD','WHATSAPP_FORWARDED'))::int AS messages,
 COUNT(*) FILTER(WHERE type='WHATSAPP_COMMENTED')::int AS comments,COUNT(DISTINCT "ticketId")::int AS conversations,COUNT(DISTINCT "clientId")::int AS clients,
 COUNT(DISTINCT to_char("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD'))::int AS "activeDays",MAX("createdAt") AS "lastAt" FROM events GROUP BY "userId"`),
 prisma.organizationMember.findMany({where:{organizationId:org,role:{not:"CLIENT"}},select:{user:{select:{id:true,name:true,email:true}}}}),
 ]);
 const people=new Map(members.map(row=>[row.user.id,row.user.name||row.user.email]));
 for(const row of counts)if(!people.has(row.userId))people.set(row.userId,"Colaborador sem vínculo ativo");
 const report=whatsappUsageReport([...people].map(([userId,name])=>{const row=counts.find(item=>item.userId===userId);return {userId,name,messages:row?.messages||0,comments:row?.comments||0,actions:row?.actions||0,conversations:row?.conversations||0,clients:row?.clients||0,activeDays:row?.activeDays||0,lastAt:row?.lastAt?new Date(row.lastAt).toISOString():null};}));
 return {...report,updatedAt:new Date().toISOString()};
 },["whatsapp-usage-v1",org,recipient,phone,start.toISOString(),end.toISOString()],{revalidate:60})();
}
