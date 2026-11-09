export class WhatsAppFileError extends Error {}
export const WHATSAPP_FILE_LIMIT = 25 * 1024 * 1024;
export const WHATSAPP_FILE_COUNT = 10;
export const WHATSAPP_FILES_BUCKET = "whatsapp-attachments";
const types: Record<string, string> = {
  jpg:"image/jpeg", jpeg:"image/jpeg", png:"image/png", webp:"image/webp", gif:"image/gif",
  pdf:"application/pdf", doc:"application/msword", docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls:"application/vnd.ms-excel", xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt:"application/vnd.ms-powerpoint", pptx:"application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt:"text/plain", csv:"text/csv", zip:"application/zip", rar:"application/vnd.rar",
  mp3:"audio/mpeg", ogg:"audio/ogg", wav:"audio/wav", m4a:"audio/mp4", mp4:"video/mp4",
};
export const WHATSAPP_FILE_ACCEPT = Object.keys(types).map(ext=>"."+ext).join(",");
export function whatsappFileInfo(name: string, size: number) {
  const extension=name.split(".").at(-1)?.toLowerCase()||"";
  const mimeType=types[extension];
  if(!name.trim()||name.length>200||/[\x00-\x1f/\\]/.test(name)||!mimeType) throw new WhatsAppFileError("Formato não suportado. Use imagens, PDF, documentos, planilhas, arquivos ZIP/RAR, áudio ou MP4.");
  if(!Number.isSafeInteger(size)||size<=0||size>WHATSAPP_FILE_LIMIT) throw new WhatsAppFileError("Cada anexo deve ter entre 1 byte e 25 MB.");
  return {name,mimeType,type:mimeType.startsWith("image/")?"image" as const:mimeType.startsWith("audio/")?"audio" as const:mimeType.startsWith("video/")?"video" as const:"document" as const};
}
export function validFileContent(name: string, bytes: Uint8Array) {
  const ext=name.split(".").at(-1)?.toLowerCase();
  const ascii=(a:number,b:number)=>String.fromCharCode(...bytes.slice(a,b));
  if(ext==="pdf")return ascii(0,5)==="%PDF-";
  if(ext==="jpg"||ext==="jpeg")return bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  if(ext==="png")return bytes[0]===137&&ascii(1,4)==="PNG";
  if(ext==="gif")return ascii(0,4)==="GIF8";
  if(ext==="webp")return ascii(0,4)==="RIFF"&&ascii(8,12)==="WEBP";
  if(["docx","xlsx","pptx","zip"].includes(ext||""))return ascii(0,2)==="PK";
  if(["doc","xls","ppt"].includes(ext||""))return bytes[0]===208&&bytes[1]===207&&bytes[2]===17&&bytes[3]===224;
  if(ext==="rar")return ascii(0,4)==="Rar!";
  if(ext==="mp4"||ext==="m4a")return ascii(4,8)==="ftyp";
  if(ext==="ogg")return ascii(0,4)==="OggS";
  if(ext==="wav")return ascii(0,4)==="RIFF"&&ascii(8,12)==="WAVE";
  if(ext==="mp3")return ascii(0,3)==="ID3"||bytes[0]===255&&(bytes[1]&224)===224;
  return (ext==="txt"||ext==="csv")&&!bytes.slice(0,4096).includes(0);
}
