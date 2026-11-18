import {expect,it} from "vitest";
import {conversationPreview} from "./conversation-preview";
import type {ConversationSnapshot} from "./conversation-read";
it("provides only a bounded read-only preview without addresses, documents, raw metadata or media storage",()=>{
 const ticket={id:"t",subject:"Contato",senderName:"Cliente",status:"NEW",updatedAt:"2026-11-18T15:00:00Z",senderEmail:"private",client:{document:"private"},messages:Array.from({length:12},(_,index)=>({id:String(index),direction:index===10?"INTERNAL":"INBOUND",fromName:"Pessoa",textBody:"a".repeat(2000),receivedAt:"2026-11-18T15:00:00Z",deletedAt:index===11?"2026-11-18T15:01:00Z":null,providerMetadata:{secret:"private"},attachments:[{id:"attachment",name:"Boleto.pdf",mimeType:"application/pdf",storageKey:"private",size:123}]}))} as unknown as ConversationSnapshot;
 const result=conversationPreview(ticket);expect(result.messages).toHaveLength(8);expect(result.messages[0].id).toBe("4");expect(result.messages.at(-1)).toMatchObject({deleted:true,body:"a".repeat(1200),attachments:[{name:"Boleto.pdf",mimeType:"application/pdf"}]});expect(result.messages[6].direction).toBe("INTERNAL");expect(JSON.stringify(result)).not.toContain("private");expect(JSON.stringify(result)).not.toContain("storageKey");
});
