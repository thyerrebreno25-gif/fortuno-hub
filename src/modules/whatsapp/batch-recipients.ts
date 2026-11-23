import {normalizeWhatsappIdentity,parseWhatsappChannelAddress,whatsappChannelAddress} from "./core";
export type BatchDestination={id:string;senderName:string|null;subject:string;senderEmail:string;status:string;assignedTo:{name:string|null;email:string}|null;lastMessageAt:Date|string};
export type BatchClientRecipient={id:string;name:string;destinations:BatchDestination[]};
export function batchAddress(address:string){const identity=parseWhatsappChannelAddress(address);return whatsappChannelAddress(identity.kind,normalizeWhatsappIdentity(identity.kind,identity.externalId));}
/** One row per client; a chat's previous tickets never become extra destinations. */
export function batchClientRecipient(client:{id:string;name:string;serviceTickets:BatchDestination[]}):BatchClientRecipient{
 const chats=new Map<string,BatchDestination>();
 const sorted=[...client.serviceTickets].sort((a,b)=>Number(a.status==="RESOLVED")-Number(b.status==="RESOLVED")||+new Date(b.lastMessageAt)-+new Date(a.lastMessageAt)||a.id.localeCompare(b.id));
 for(const ticket of sorted){const address=batchAddress(ticket.senderEmail);if(!chats.has(address))chats.set(address,ticket);}
 return {id:client.id,name:client.name,destinations:[...chats.values()]};
}
