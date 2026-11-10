export type QuotedMessage={id:string|null;sourceTicketId:string|null;fromName:string|null;textBody:string|null;receivedAt:string|null;attachmentName:string|null};
const obj=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const str=(value:unknown,max=1000)=>typeof value==="string"?value.slice(0,max):"";
export function normalizeMessageQuote(message:Record<string,unknown>,content:Record<string,unknown>){
 const wrapped=[content,obj(content.extendedTextMessage),obj(content.imageMessage),obj(content.videoMessage),obj(content.documentMessage),obj(content.audioMessage)];
 const context=wrapped.map(value=>obj(value.contextInfo)).find(value=>value.stanzaId||value.quotedMessage)||obj(message.contextInfo);
 const apiId=str(message.quoted||context.stanzaId||obj(content.quotedMessage).id,250);
 const externalId=apiId.split(":").at(-1)||"";
 if(!externalId)return null;
 const original=obj(context.quotedMessage||content.quotedMessage),extended=obj(original.extendedTextMessage);
 const image=obj(original.imageMessage),document=obj(original.documentMessage),video=obj(original.videoMessage);
 const body=str(original.conversation||extended.text||image.caption||document.caption||video.caption||original.text);
 const attachmentName=str(document.fileName,200)||(original.imageMessage?"Imagem":original.videoMessage?"Vídeo":original.audioMessage?"Áudio":original.stickerMessage?"Figurinha":"");
 return {externalId,apiId,fallback:{id:null,sourceTicketId:null,fromName:str(original.senderName||context.pushName,150)||null,textBody:body||null,receivedAt:null,attachmentName:attachmentName||null} satisfies QuotedMessage};
}
