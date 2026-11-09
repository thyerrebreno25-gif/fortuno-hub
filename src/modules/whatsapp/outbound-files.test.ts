import {expect,it} from "vitest";
import {validFileContent,whatsappFileInfo,WHATSAPP_FILE_LIMIT} from "./outbound-files";
import {validReactionEmoji} from "./reaction-core";
it("accepts PDF, office files and images with canonical MIME types",()=>{
 expect(whatsappFileInfo("fatura.PDF",25)).toMatchObject({type:"document",mimeType:"application/pdf"});
 expect(whatsappFileInfo("imagem.jpg",25)).toMatchObject({type:"image",mimeType:"image/jpeg"});
 expect(whatsappFileInfo("contrato.docx",25).type).toBe("document");
});
it("rejects active content, path traversal, empty files and oversized uploads",()=>{
 for(const name of ["a.exe","a.svg","a.html","../arquivo.pdf","a\\b.pdf","a.js","a.pdf.exe"])expect(()=>whatsappFileInfo(name,25)).toThrow();
 expect(()=>whatsappFileInfo("a.pdf",0)).toThrow();expect(()=>whatsappFileInfo("a.pdf",WHATSAPP_FILE_LIMIT+1)).toThrow();
});
it("checks bytes instead of trusting the filename",()=>{
 const bytes=(value:string)=>new TextEncoder().encode(value);
 expect(validFileContent("a.pdf",bytes("%PDF-1.7\n"))).toBe(true);
 expect(validFileContent("a.pdf",bytes("<script>bad</script>"))).toBe(false);
 expect(validFileContent("a.docx",bytes("PK\u0003\u0004"))).toBe(true);
 expect(validFileContent("a.png",bytes("not-a-png"))).toBe(false);
});
it("accepts a single composed emoji or removal and rejects arbitrary text or multiple reactions",()=>{
 for(const value of ["👍","❤️","⚠️","👩🏽‍💻",""])expect(validReactionEmoji(value)).toBe(true);
 for(const value of ["approved","👍👍","x❤️",null,12])expect(validReactionEmoji(value)).toBe(false);
});
