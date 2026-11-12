import "server-only";
import {unstable_cache} from "next/cache";
import {prisma} from "@/lib/prisma";
import {decryptIntegrationSecret} from "@/modules/purchase-invoices/server/crypto";
import {uazapiRequest} from "./uazapi";
import {chatProfile} from "./chat-info";
import {isContactName} from "./contact-name";
import type {whatsappConnection} from "./uazapi-server";
type Connection=NonNullable<Awaited<ReturnType<typeof whatsappConnection>>>;
export async function resolvedChatProfile(connection:Connection,externalId:string,group:boolean){
  return unstable_cache(async()=>chatProfile(await uazapiRequest(connection.serverUrl,decryptIntegrationSecret(connection.tokenEncrypted),group?"/group/info":"/chat/details",group?{groupjid:externalId}:{number:externalId,preview:false}),group),["whatsapp-chat-info-v1",connection.organizationId,connection.id,connection.instanceId,connection.phone||"",externalId],{revalidate:120})();
}
export async function rememberChatName(connection:Connection,senderEmail:string,name:string|null){
  if(!connection.phone || !name || !isContactName(name))return;
  // An authoritative profile name belongs only to this tenant, number and exact chat.
  await prisma.serviceTicket.updateMany({where:{organizationId:connection.organizationId,source:"WHATSAPP_API",recipientEmail:`wa-account:${connection.id}:${connection.phone}`,senderEmail,OR:[{senderName:{not:name}},{subject:{not:name}},{senderName:null}]},data:{senderName:name!,subject:name!,updatedAt:new Date()}});
}
