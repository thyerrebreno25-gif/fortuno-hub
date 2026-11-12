import "server-only";
import {unstable_cache} from "next/cache";
import {Prisma} from "@/generated/prisma/client";
import {enrichGroupMemberNames,memberAliases,type GroupMember} from "./group-members";
import {prisma} from "@/lib/prisma";
import {decryptIntegrationSecret} from "@/modules/purchase-invoices/server/crypto";
import {uazapiRequest} from "./uazapi";
import {chatProfile} from "./chat-info";
import {isContactName} from "./contact-name";
import type {whatsappConnection} from "./uazapi-server";
type Connection=NonNullable<Awaited<ReturnType<typeof whatsappConnection>>>;
export async function resolvedChatProfile(connection:Connection,externalId:string,group:boolean){
  return unstable_cache(async()=>chatProfile(await uazapiRequest(connection.serverUrl,decryptIntegrationSecret(connection.tokenEncrypted),group?"/group/info":"/chat/details",group?{groupjid:externalId}:{number:externalId,preview:false}),group),["whatsapp-chat-info-v2",connection.organizationId,connection.id,connection.instanceId,connection.phone||"",externalId],{revalidate:120})();
}
export async function rememberChatName(connection:Connection,senderEmail:string,name:string|null){
  if(!connection.phone || !name || !isContactName(name))return;
  // An authoritative profile name belongs only to this tenant, number and exact chat.
  await prisma.serviceTicket.updateMany({where:{organizationId:connection.organizationId,source:"WHATSAPP_API",recipientEmail:`wa-account:${connection.id}:${connection.phone}`,senderEmail,OR:[{senderName:{not:name}},{subject:{not:name}},{senderName:null}]},data:{senderName:name!,subject:name!,updatedAt:new Date()}});
}

export async function resolvedGroupMemberNames(connection:Connection,groupJid:string,members:GroupMember[]){
 if(!members.length||!connection.phone)return members;
 const ids=[...new Set(members.flatMap(memberAliases))];
 const [directory,senders]=await Promise.all([
  prisma.whatsAppDirectoryEntry.findMany({where:{organizationId:connection.organizationId,connectionId:connection.id,accountPhone:connection.phone,active:true,kind:"CONTACT",externalId:{in:ids}},select:{externalId:true,displayName:true}}),
  prisma.$queryRaw<Array<{sender:string;name:string}>>(Prisma.sql`SELECT DISTINCT ON (COALESCE(m."providerMetadata"->>'senderJid',m."providerMetadata"->>'sender')) COALESCE(m."providerMetadata"->>'senderJid',m."providerMetadata"->>'sender') AS sender,m."fromName" AS name
   FROM "ServiceMessage" m JOIN "ServiceTicket" t ON t.id=m."ticketId"
   WHERE t."organizationId"=${connection.organizationId} AND t.source='WHATSAPP_API' AND t."recipientEmail"=${`wa-account:${connection.id}:${connection.phone}`} AND t."senderEmail"=${`wa-group:${groupJid}`}
    AND m.direction::text='INBOUND' AND m."fromName" IS NOT NULL AND COALESCE(m."providerMetadata"->>'senderJid',m."providerMetadata"->>'sender')=ANY(${ids}::text[])
   ORDER BY COALESCE(m."providerMetadata"->>'senderJid',m."providerMetadata"->>'sender'),m."receivedAt" DESC,m.id DESC`)
 ]);
 return enrichGroupMemberNames(members,new Map(directory.map(row=>[row.externalId,row.displayName])),new Map(senders.map(row=>[row.sender,row.name])));
}
