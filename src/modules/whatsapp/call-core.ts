// Uazapi CallLog.callResult and WhatsApp CallLogMessage.callOutcome use different enums.
export type WhatsAppCall = {
  id: string; media: "voice" | "video" | "unknown";
  status: "offered" | "accepted" | "ended" | "connected" | "missed" | "rejected" | "cancelled" | "elsewhere" | "failed" | "unavailable" | "unknown";
  timestamp: number; durationSeconds?: number; final?: boolean; answered?: boolean;
};
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const str = (v: unknown) => typeof v === "string" ? v.slice(0, 200) : "";
export const callFlag = (v: unknown) => v === true || v === 1 || v === "true" || v === "1";
export function callTimestamp(v: unknown, fallback = Date.now()) {
  const n = typeof v === "string" && !/^\d+(\.\d+)?$/.test(v) ? Date.parse(v) : Number(v);
  const ms = n > 0 && n < 1e12 ? n * 1000 : n;
  return Number.isFinite(ms) && ms > 0 && ms < 8640000000000000 ? ms : fallback;
}
const logResults: Record<string, WhatsAppCall["status"]> = {0:"connected",1:"rejected",2:"cancelled",3:"elsewhere",4:"missed",5:"failed",6:"unavailable",8:"failed",9:"cancelled"};
const outcomes: Record<string, WhatsAppCall["status"]> = {0:"connected",1:"missed",2:"failed",3:"rejected",4:"elsewhere",5:"accepted",6:"missed",7:"missed",CONNECTED:"connected",MISSED:"missed",FAILED:"failed",REJECTED:"rejected",ACCEPTED_ELSEWHERE:"elsewhere",ONGOING:"accepted",SILENCED_BY_DND:"missed",SILENCED_UNKNOWN_CALLER:"missed"};
export function messageCall(message: Record<string, unknown>, content: Record<string, unknown>): WhatsAppCall | null {
  const type = str(message.messageType), stub = message.messageStubType ?? content.messageStubType;
  const missed = /CALL_MISSED/.test(str(stub)) || [40,41,45,46].includes(Number(stub));
  if (!missed && !/^(?:Call|CallLogMessage|CallMessage|MissedCall|MissedVoiceCall|MissedVideoCall|CALL_MISSED.*)$/i.test(type) && !content.callLogMessage) return null;
  const log = content.callLogMessage ? obj(content.callLogMessage) : content;
  const status = missed || /missed/i.test(type) ? "missed" : outcomes[String(log.callOutcome)] || (log.callResult !== undefined ? logResults[String(log.callResult)] : undefined) || "unknown";
  const video = callFlag(log.isVideo) || /VIDEO/i.test(type + str(stub)) || [41,46].includes(Number(stub));
  const duration = Number(log.durationSecs ?? log.durationSeconds);
  return { id: str(log.callID || log.callId || message.messageid || message.id), media: video ? "video" : "voice", status, timestamp: callTimestamp(message.messageTimestamp), ...(Number.isFinite(duration) && duration >= 0 ? {durationSeconds: Math.min(duration, 604800)} : {}), final: !["offered","accepted","unknown"].includes(status) };
}
export function nativeCall(root: Record<string, unknown>) {
  const event = obj(root.event), data = obj(event.Data);
  const id = str(event.CallID || event.callID);
  if (!id) return null;
  const log = root.type === "CallLog";
  const state = str(root.callState || data.Tag).toLowerCase();
  const reason = str(event.Reason).toLowerCase();
  const states: Record<string, WhatsAppCall["status"]> = {offer:"offered",offered:"offered",accept:"accepted",accepted:"accepted",terminate:"ended",terminated:"ended",reject:"rejected",rejected:"rejected"};
  const status = log ? logResults[String(event.callResult)] || "unknown" : /^(missed|timeout|no_answer)$/.test(reason) ? "missed" : /^(cancel|cancelled)$/.test(reason) ? "cancelled" : states[state];
  // Latency/transport notifications are not conversation messages.
  if (!log && !status) return null;
  const media = callFlag(event.isVideo) || /video/i.test(str(event.Media)) ? "video" : /audio|voice/i.test(str(event.Media)) || event.isVideo === false ? "voice" : "unknown";
  const call: WhatsAppCall = {id, media, status:status || "unknown",timestamp:callTimestamp(event.Timestamp ?? event.timestamp),final:log || ["ended","missed","rejected","cancelled"].includes(status || "")};
  const owner = str(root.owner).split("@")[0];
  const creator = str(event.CallCreator || event.callCreatorJID).split("@")[0];
  const creatorAlt=str(event.CallCreatorAlt).split("@")[0];
  const fromMe = root.fromMe !== undefined ? callFlag(root.fromMe) : event.isIncoming !== undefined ? !callFlag(event.isIncoming) : Boolean(owner && (creator === owner || creatorAlt === owner));
  const candidates = [root.chatid,event.GroupJID,event.groupJID,root.sender_pn,root.sender_lid,event.From,!fromMe ? event.CallCreator : null];
  const chatId = candidates.map(str).find(v => /^[0-9]+(?:-[0-9]+)?@(s\.whatsapp\.net|g\.us|lid)$/.test(v) && (v.endsWith("@g.us") || v.split("@")[0] !== owner)) || "";
  return {kind:"call" as const,id,chatId,fromMe,call,senderName:str(event.senderName || root.senderName)};
}
export function mergeCall(previous: WhatsAppCall | null, next: WhatsAppCall): WhatsAppCall {
  if (!previous) return next;
  const rank = (call: WhatsAppCall) => call.final ? call.status === "ended" ? 2 : 3 : call.status === "accepted" ? 1 : 0;
  const winner = rank(next) >= rank(previous) ? next : previous;
  const answered=previous.answered||next.answered||[previous.status,next.status].some(status=>["accepted","connected","elsewhere"].includes(status));
  return {...previous,...winner, answered, timestamp:Math.min(previous.timestamp,next.timestamp), media: winner.media !== "unknown" ? winner.media : previous.media !== "unknown" ? previous.media : next.media, ...(next.durationSeconds !== undefined ? {durationSeconds:next.durationSeconds} : {}), ...(winner.status === "ended" && answered ? {status:"connected" as const} : {})};
}
export function callLabel(call: WhatsAppCall, outbound: boolean) {
  const medium = call.media === "video" ? "de vídeo" : call.media === "voice" ? "de voz" : "do WhatsApp";
  const status: Record<WhatsAppCall["status"],string> = {offered:outbound?"realizada · chamando":"recebida · tocando",accepted:"atendida",ended:"encerrada",connected:"atendida",missed:outbound?"realizada · não atendida":"perdida",rejected:"recusada",cancelled:"cancelada",elsewhere:"atendida em outro dispositivo",failed:"com falha",unavailable:"indisponível",unknown:outbound?"realizada":"recebida"};
  const date = new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date(call.timestamp)).replace(",", "");
  return `Chamada ${medium} ${status[call.status]} em ${date}`;
}
