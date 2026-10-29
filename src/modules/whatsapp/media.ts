export type MediaKind = "image" | "audio" | "video" | "file";
export function mediaKind(mime: string | null, name: string, message = ""): MediaKind {
  const type = (mime || "").toLowerCase().split(";")[0];
  if (/^image\/(jpeg|png|webp|gif|avif)$/.test(type)) return "image";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("video/")) return "video";
  if (/\.(png|jpe?g|gif|webp|avif)$/i.test(name) || /^(Image|Sticker)Message$/i.test(name) || /^\[(Image|Sticker)Message\]$/.test(message)) return "image";
  if (/\.(mp3|ogg|opus|wav|m4a|aac)$/i.test(name) || /^AudioMessage$/i.test(name) || message === "[AudioMessage]") return "audio";
  if (/\.(mp4|webm|mov)$/i.test(name) || /^VideoMessage$/i.test(name) || message === "[VideoMessage]") return "video";
  return "file";
}
export function previewMime(body: Uint8Array, declared: string) {
  const ascii = (start: number, end: number) => String.fromCharCode(...body.slice(start, end));
  if (body[0] === 255 && body[1] === 216 && body[2] === 255) return "image/jpeg";
  if (body[0] === 137 && ascii(1, 4) === "PNG") return "image/png";
  if (ascii(0, 4) === "GIF8") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(0, 4) === "OggS") return "audio/ogg";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "audio/wav";
  if (ascii(4, 8) === "ftyp") return /^avi[fs]/i.test(ascii(8, 12)) ? "image/avif" : /^m4[ab]/i.test(ascii(8, 12)) ? "audio/mp4" : "video/mp4";
  if (ascii(0, 3) === "ID3" || body[0] === 255 && (body[1] & 0xe0) === 0xe0) return "audio/mpeg";
  const type = declared.toLowerCase().split(";")[0].trim();
  return /^(image\/(jpeg|png|webp|gif|avif)|audio\/(ogg|opus|mpeg|mp3|mp4|aac|wav|webm|x-m4a)|video\/(mp4|webm|quicktime))$/.test(type) ? type : null;
}
export function byteRange(header: string | null, size: number) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || !size || !match[1] && !match[2]) return false;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) return false;
  return { start, end };
}
