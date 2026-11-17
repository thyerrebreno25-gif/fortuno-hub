import {expect,it} from "vitest";
import {applyMessageMutation,messageEditProblem,MESSAGE_EDIT_MS} from "./message-edit";
const now=Date.parse("2026-11-17T13:00:00Z");
it("allows a confirmed text message until the edit deadline, using original send time",()=>{
 expect(messageEditProblem({receivedAt:new Date(now-MESSAGE_EDIT_MS+1),attachments:[]},now)).toBeNull();
 expect(messageEditProblem({receivedAt:new Date(now-MESSAGE_EDIT_MS),attachments:[]},now)).toContain("15 minutos");
});
it("blocks invalid dates, future dates, failed sends and attachments",()=>{
 for(const message of [{receivedAt:"invalid",attachments:[]},{receivedAt:new Date(now+1),attachments:[]},{receivedAt:new Date(now),attachments:[{}]},{receivedAt:new Date(now),attachments:[],deliveryStatus:"unconfirmed"}])expect(messageEditProblem(message,now)).toBeTruthy();
});
it("updates an older loaded message immediately without changing order, dates or other references",()=>{
 const old={id:"old",textBody:"Original",receivedAt:"2026-11-17T12:50:00Z"},next={id:"next",textBody:"Resposta",receivedAt:"2026-11-17T12:55:00Z"};
 const rows=applyMessageMutation([old,next],{messageId:"old",textBody:"Corrigida",editedAt:"2026-11-17T13:00:00Z"});
 expect(rows[0]).toEqual({...old,textBody:"Corrigida",editedAt:"2026-11-17T13:00:00Z"});expect(rows[1]).toBe(next);
 expect(rows.map(m=>m.id)).toEqual(["old","next"]);
});
it("preserves text when a deletion is confirmed and leaves unrelated conversations untouched",()=>{
 const rows=[{id:"a",textBody:"Conteúdo"}];expect(applyMessageMutation(rows,{messageId:"other",textBody:"Outro"})).toBe(rows);
 expect(applyMessageMutation(rows,{messageId:"a",deletedAt:"now"})[0]).toMatchObject({textBody:"Conteúdo",deletedAt:"now"});
});
