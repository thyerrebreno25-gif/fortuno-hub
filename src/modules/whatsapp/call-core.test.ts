import {expect,it} from "vitest";
import {callLabel,mergeCall,nativeCall,messageCall,type WhatsAppCall} from "./call-core";
const timestamp=Date.parse("2026-11-11T13:20:00Z");
const base:WhatsAppCall={id:"call",media:"voice",status:"offered",timestamp};
it("keeps the two provider result enums distinct, including numeric zero",()=>{
 expect(messageCall({messageType:"CallLogMessage",messageid:"m",messageTimestamp:timestamp},{callOutcome:1})?.status).toBe("missed");
 expect(nativeCall({type:"CallLog",event:{callID:"c",callResult:1}})?.call.status).toBe("rejected");
 expect(messageCall({messageType:"CallLogMessage",messageTimestamp:timestamp},{callOutcome:0})?.status).toBe("connected");
 expect(nativeCall({type:"CallLog",event:{callID:"c",callResult:0}})?.call.status).toBe("connected");
});
it("recognizes missed voice/video stubs, preserves unknown outcomes and ignores normal messages",()=>{
 expect(messageCall({messageid:"m",messageStubType:40},{})?.status).toBe("missed");
 expect(messageCall({messageid:"m",messageStubType:"CALL_MISSED_GROUP_VIDEO"},{})?.media).toBe("video");
 expect(messageCall({messageType:"CallLogMessage"},{})?.status).toBe("unknown");
 expect(messageCall({messageType:"Conversation"},{conversation:"Vou ligar"})).toBeNull();
});
it("renders missed inbound and unanswered outbound distinctly, with the Brasilia date",()=>{
 expect(callLabel({...base,status:"missed"},false)).toBe("Chamada de voz perdida em 11/11/2026 10:20");
 expect(callLabel({...base,status:"missed"},true)).toContain("realizada · não atendida");
 expect(callLabel({...base,status:"unknown"},true)).toContain("realizada");
 expect(callLabel({...base,status:"unknown"},false)).not.toContain("perdida");
});
it("uses the creator as fallback and trusts explicit origin flags for LID callers",()=>{
 const result=nativeCall({owner:"5511",event:{CallID:"c",CallCreator:"5522@s.whatsapp.net",From:"5511@s.whatsapp.net",Timestamp:"2026-11-11T13:20:00Z",Data:{Tag:"accept"}}});
 expect(result).toMatchObject({fromMe:false,chatId:"5522@s.whatsapp.net",call:{status:"accepted",timestamp}});
 expect(nativeCall({owner:"5511",fromMe:true,chatid:"5522@s.whatsapp.net",event:{CallID:"out",CallCreator:"999@lid",Data:{Tag:"offer"}}})).toMatchObject({fromMe:true,chatId:"5522@s.whatsapp.net"});
});
it("never invents the remote contact for a call log containing only its id",()=>{
 expect(nativeCall({owner:"5511",fromMe:true,type:"CallLog",event:{callID:"c",callResult:0}})).toMatchObject({chatId:"",fromMe:true});
 expect(nativeCall({owner:"5511",fromMe:true,event:{CallID:"c",Data:{Tag:"latency"}}})).toBeNull();
});
it("keeps final result, media and original start when transitions arrive out of order",()=>{
 const complete=mergeCall(base,{...base,status:"missed",final:true,timestamp:timestamp+60000,media:"video"});
 expect(mergeCall(complete,base)).toMatchObject({status:"missed",media:"video",timestamp});
 const ended=mergeCall(base,{...base,status:"ended",final:true,timestamp:timestamp+60000});
 expect(mergeCall(ended,{...base,status:"accepted"})).toMatchObject({status:"connected",final:true});
 expect(mergeCall({...base,status:"connected",final:true},{...base,status:"ended",final:true})).toMatchObject({status:"connected"});
});
