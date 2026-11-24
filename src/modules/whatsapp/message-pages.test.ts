import { expect,it } from "vitest";
import { mergeChatMessages } from "./message-pages";
const msg=(id:string,receivedAt=id):{id:string;receivedAt:string;status:string;clientRequestId?:string|null;reconciledEchoId?:string|null}=>({id,receivedAt,status:"sent"});
it("keeps older pages while merging live messages without duplicates",()=>{const first=msg("1"),second=msg("2");expect(mergeChatMessages([first,second],[msg("2"),msg("3")]).map(row=>row.id)).toEqual(["1","2","3"]);});
it("keeps references stable when repeated polling returns the same messages",()=>{const current=[msg("1"),msg("2")];expect(mergeChatMessages(current,[msg("1"),msg("2")])).toBe(current);});
it("updates delivery receipts and handles messages sharing a timestamp deterministically",()=>{const current=[msg("1","same"),msg("2","same")];const result=mergeChatMessages(current,[{...msg("2","same"),status:"read"}]);expect(result[0]).toBe(current[0]);expect(result[1].status).toBe("read");expect(result.map(row=>row.id)).toEqual(["1","2"]);});
it("preserves an earlier unconfirmed message when the next send succeeds",()=>{
 const failed={...msg("pending:first","1"),clientRequestId:"first",status:"unconfirmed"},pending={...msg("pending:second","2"),clientRequestId:"second"};
 const result=mergeChatMessages([failed,pending],[{...msg("durable-second","2"),clientRequestId:"second"}]);
 expect(result.map(row=>row.id)).toEqual(["pending:first","durable-second"]);expect(result[0]).toBe(failed);
 const recovered=mergeChatMessages(result,[{...msg("durable-first","1"),clientRequestId:"first",status:"read"}]);
 expect(recovered.map(row=>row.id)).toEqual(["durable-first","durable-second"]);
});
it("removes a reconciled generic echo from the live cache as well as its optimistic row",()=>{
 const current=[msg("generic-echo","2"),{...msg("pending:request","1"),clientRequestId:"request"}];
 const result=mergeChatMessages(current,[{...msg("intent","1"),clientRequestId:"request",reconciledEchoId:"generic-echo"}]);
 expect(result.map(row=>row.id)).toEqual(["intent"]);
});
