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
