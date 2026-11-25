import {expect,it} from "vitest";
import {validFileContent,whatsappFileInfo,WHATSAPP_FILE_LIMIT,WHATSAPP_FILE_ACCEPT} from "./outbound-files";
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
it("exposes XML in the shared file picker and sends invoices as documents with a canonical MIME",()=>{
 expect(WHATSAPP_FILE_ACCEPT.split(",")).toContain(".xml");
 expect(whatsappFileInfo("35261100000000000100550010000000011000000010-NFe.XML",250)).toMatchObject({type:"document",mimeType:"application/xml"});
});
it("recognizes invoice XML with declarations, namespaces, BOM and common text encodings without modifying bytes",()=>{
 const source='<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="example"><emit><xNome>Comércio</xNome></emit></infNFe></NFe></nfeProc>';
 for(const text of [source,"\uFEFF"+source,'  <NFe xmlns="http://www.portalfiscal.inf.br/nfe"/>','<!-- Nota fiscal --><nfse:CompNfse xmlns:nfse="urn:nfse"/>','<?xml version="1.0" encoding="ISO-8859-1"?><nota/>']){
  const bytes=new TextEncoder().encode(text),original=bytes.slice();expect(validFileContent("nota.xml",bytes)).toBe(true);expect(bytes).toEqual(original);
 }
 for(const littleEndian of [true,false]){
  const xml='<NFe xmlns="urn:nfe"/>',bytes=new Uint8Array(2+xml.length*2),view=new DataView(bytes.buffer);view.setUint16(0,0xfeff,littleEndian);for(let i=0;i<xml.length;i++)view.setUint16(2+i*2,xml.charCodeAt(i),littleEndian);
  expect(validFileContent("nota.xml",bytes)).toBe(true);expect(validFileContent("nota.xml",bytes.slice(2))).toBe(true);
 }
});
it("rejects unrelated binary, PDF or plain text renamed to XML",()=>{
 for(const source of ["MZexecutable","%PDF-1.7","{\"nota\":1}","nota fiscal","<NFe>\u0000</NFe>"]){expect(validFileContent("nota.xml",new TextEncoder().encode(source))).toBe(false);}
 expect(validFileContent("nota.xml",new Uint8Array())).toBe(false);
});
it("accepts a single composed emoji or removal and rejects arbitrary text or multiple reactions",()=>{
 for(const value of ["👍","❤️","⚠️","👩🏽‍💻",""])expect(validReactionEmoji(value)).toBe(true);
 for(const value of ["approved","👍👍","x❤️",null,12])expect(validReactionEmoji(value)).toBe(false);
});
