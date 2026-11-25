const extensions:Record<string,string>={"image/png":"png","image/jpeg":"jpg","image/webp":"webp","image/gif":"gif"};
export function clipboardImageFiles(data:{items?:ArrayLike<Pick<DataTransferItem,"kind"|"type"|"getAsFile">>;files?:ArrayLike<File>},now=Date.now()):File[]{
 const images=Array.from(data.items||[]).filter(item=>item.kind==="file"&&item.type.startsWith("image/")).map(item=>item.getAsFile()).filter((file):file is File=>Boolean(file));
 const candidates=images.length?images:Array.from(data.files||[]).filter(file=>file.type.startsWith("image/"));
 const seen=new Set<File>();
 return candidates.filter(file=>{if(seen.has(file))return false;seen.add(file);return true;}).map((file,index)=>{
   const extension=extensions[file.type];
   if(!extension||/\.(png|jpe?g|gif|webp)$/i.test(file.name))return file;
   return new File([file],`print-${now}-${index+1}.${extension}`,{type:file.type,lastModified:file.lastModified});
 });
}
/** Keep pasted files (including videos); text-only paste still belongs to the composer. */
export function clipboardAttachmentFiles(data:Parameters<typeof clipboardImageFiles>[0],now=Date.now()):File[]{
 const items=Array.from(data.items||[]).filter(item=>item.kind==="file").map(item=>item.getAsFile()).filter((file):file is File=>Boolean(file));
 const extensions:Record<string,string>={"video/mp4":"mp4","video/quicktime":"mov","video/x-m4v":"m4v","video/webm":"webm","video/3gpp":"3gp","video/x-msvideo":"avi","video/x-matroska":"mkv"};
 const seen=new Set<string>();
 return [...items,...Array.from(data.files||[])].filter(file=>{const key=JSON.stringify([file.name,file.size,file.type,file.lastModified]);if(seen.has(key))return false;seen.add(key);return true;}).map((file,index)=>{
  if(file.type.startsWith("image/"))return clipboardImageFiles({files:[file]},now+index)[0]||file;
  const ext=extensions[file.type.toLowerCase()];
  if(!ext||/\.[^.]+$/.test(file.name))return file;
  return new File([file],`video-${now}-${index+1}.${ext}`,{type:file.type,lastModified:file.lastModified});
 });
}
