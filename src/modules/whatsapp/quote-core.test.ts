import {expect,it} from "vitest";
import {normalizeMessageQuote} from "./quote-core";
it("reads the documented quoted id and context excerpt from an incoming reply",()=>{
 expect(normalizeMessageQuote({quoted:"5511:OLD-ID"},{contextInfo:{stanzaId:"OLD-ID",quotedMessage:{conversation:"Mensagem de ontem"}}})).toMatchObject({externalId:"OLD-ID",fallback:{textBody:"Mensagem de ontem",id:null}});
});
it("keeps the original image caption and filename for media replies",()=>{
 const quote=normalizeMessageQuote({}, {extendedTextMessage:{contextInfo:{stanzaId:"image-id",quotedMessage:{imageMessage:{caption:"Segue o comprovante"}}}}});
 expect(quote).toMatchObject({externalId:"image-id",fallback:{textBody:"Segue o comprovante",attachmentName:"Imagem"}});
});
it("does not confuse unrelated content or a reaction with a quote",()=>{expect(normalizeMessageQuote({text:"ontem",reaction:"target"},{})).toBeNull();});
it("bounds provider excerpts and does not propagate HTML or raw provider fields",()=>{
 const quote=normalizeMessageQuote({quoted:"old-id",token:"secret"},{contextInfo:{quotedMessage:{conversation:"x".repeat(6000),html:"secret"}}});
 expect(quote?.fallback.textBody).toHaveLength(1000);expect(JSON.stringify(quote)).not.toContain("secret");
});
