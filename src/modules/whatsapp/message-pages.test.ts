import { expect,it } from "vitest";
import { mergeChatMessages } from "./message-pages";
const msg=(id:string,receivedAt=id)=>({id,receivedAt,status:"sent"});
it("keeps older pages while merging live messages without duplicates",()=>{const first=msg("1"),second=msg("2");expect(mergeChatMessages([first,second],[msg("2"),msg("3")]).map(row=>row.id)).toEqual(["1","2","3"]);});
it("keeps references stable when repeated polling returns the same messages",()=>{const current=[msg("1"),msg("2")];expect(mergeChatMessages(current,[msg("1"),msg("2")])).toBe(current);});
it("updates delivery receipts and handles messages sharing a timestamp deterministically",()=>{const current=[msg("1","same"),msg("2","same")];const result=mergeChatMessages(current,[{...msg("2","same"),status:"read"}]);expect(result[0]).toBe(current[0]);expect(result[1].status).toBe("read");expect(result.map(row=>row.id)).toEqual(["1","2"]);});
