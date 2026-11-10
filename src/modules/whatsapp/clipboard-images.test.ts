import {expect,it,vi} from "vitest";
import {clipboardImageFiles} from "./clipboard-images";
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
