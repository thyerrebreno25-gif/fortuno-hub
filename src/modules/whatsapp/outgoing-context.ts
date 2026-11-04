import {object,text} from "./uazapi";
import {parseWhatsappChannelAddress} from "./core";
export function outgoingContext(recipientEmail:string|null,senderEmail:string,connection:{id:string;instanceId:string;phone:string|null}|null,rawMetadata:unknown){
 if(!connection?.phone)throw new Error("Conecte o WhatsApp antes de enviar.");
 const metadata=object(rawMetadata), owns=recipientEmail===`wa-account:${connection.id}:${connection.phone}`;
 const legacy=metadata.provider==="UAZAPI"&&metadata.connectionId===connection.id&&metadata.accountPhone===connection.phone;
 if(!owns&&!legacy)throw new Error("A conversa não está vinculada à conta conectada. Abra o contato pela agenda atual.");
 return {instanceId:connection.instanceId,to:parseWhatsappChannelAddress(senderEmail).externalId,replyToMessageId:metadata.instanceId===connection.instanceId?text(metadata.messageId)||undefined:undefined};
}
