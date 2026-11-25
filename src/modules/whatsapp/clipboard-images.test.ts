import {expect,it,vi} from "vitest";
import {clipboardImageFiles,clipboardAttachmentFiles} from "./clipboard-images";
it("takes screenshots from paste items and names images without a valid extension",()=>{
 const file=new File(["png"],"image",{type:"image/png"});
 const result=clipboardImageFiles({items:[{kind:"file",type:"image/png",getAsFile:()=>file}]},123);
 expect(result[0].name).toBe("print-123-1.png");expect(result[0].type).toBe("image/png");expect(result[0].size).toBe(3);
});
it("preserves normal text paste and ignores nonimage files",()=>{
 const getAsFile=vi.fn();expect(clipboardImageFiles({items:[{kind:"string",type:"text/plain",getAsFile}]})).toEqual([]);expect(getAsFile).not.toHaveBeenCalled();
 expect(clipboardImageFiles({files:[new File(["pdf"],"a.pdf",{type:"application/pdf"})]})).toEqual([]);
});
it("does not duplicate an image present in both clipboard representations",()=>{
 const file=new File(["png"],"print.png",{type:"image/png"});
 expect(clipboardImageFiles({items:[{kind:"file",type:"image/png",getAsFile:()=>file}],files:[file]})).toEqual([file]);
});
it("supports browsers that only supply pasted files and preserves a valid filename",()=>{
 const file=new File(["jpg"],"foto.jpg",{type:"image/jpeg"});expect(clipboardImageFiles({files:[file]})[0]).toBe(file);
});
it("recognizes a pasted video from items or files without duplicating either representation",()=>{
 const file=new File(["video"],"gravacao.mp4",{type:"video/mp4"});expect(clipboardAttachmentFiles({items:[{kind:"file",type:file.type,getAsFile:()=>file}],files:[file]})).toEqual([file]);expect(clipboardAttachmentFiles({files:[file]})).toEqual([file]);
});
it("names unnamed clipboard videos, keeps named originals and supports mixed images/documents",()=>{
 const video=new File(["video"],"video",{type:"video/quicktime"}),pdf=new File(["pdf"],"a.pdf",{type:"application/pdf"}),image=new File(["png"],"image",{type:"image/png"});
 const result=clipboardAttachmentFiles({files:[video,pdf,image]},123);expect(result.map(f=>f.name)).toEqual(["video-123-1.mov","a.pdf","print-125-1.png"]);expect(result[0].size).toBe(video.size);expect(result[1]).toBe(pdf);
});
it("leaves text paste alone and does not relabel an executable disguised with a video MIME",()=>{
 const read=vi.fn();expect(clipboardAttachmentFiles({items:[{kind:"string",type:"text/plain",getAsFile:read}]})).toEqual([]);expect(read).not.toHaveBeenCalled();
 const file=new File(["MZ"],"arquivo.exe",{type:"video/mp4"});expect(clipboardAttachmentFiles({files:[file]})[0].name).toBe("arquivo.exe");
});
