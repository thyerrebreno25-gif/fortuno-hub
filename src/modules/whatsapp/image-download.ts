import sharp from "sharp";
export async function imageDownload(body:Uint8Array,mimeType:string,name:string){
 if(!["image/png","image/jpeg","image/webp","image/gif"].includes(mimeType))return {body,mimeType,name};
 const png=await sharp(body,{limitInputPixels:40000000,animated:false}).rotate().png().toBuffer();
 const base=(name||"imagem-whatsapp").replace(/\.[a-z0-9]{1,8}$/i,"").replace(/[\x00-\x1f]/g,"").slice(0,180)||"imagem-whatsapp";
 return {body:new Uint8Array(png),mimeType:"image/png",name:base+".png"};
}
