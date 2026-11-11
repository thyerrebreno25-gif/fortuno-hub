import {expect,it} from "vitest";
import sharp from "sharp";
import {imageDownload} from "./image-download";
it("converts actual JPEG bytes to PNG with an explicit extension",async()=>{const jpg=await sharp({create:{width:3,height:2,channels:3,background:"red"}}).jpeg().toBuffer();const file=await imageDownload(jpg,"image/jpeg","ImageMessage");expect(file.name).toBe("ImageMessage.png");expect(file.mimeType).toBe("image/png");expect([...file.body.slice(0,8)]).toEqual([137,80,78,71,13,10,26,10]);expect((await sharp(file.body).metadata()).width).toBe(3);});
it("leaves documents unchanged",async()=>{const body=new Uint8Array([37,80,68,70]);expect(await imageDownload(body,"application/pdf","boleto.pdf")).toEqual({body,mimeType:"application/pdf",name:"boleto.pdf"});});
