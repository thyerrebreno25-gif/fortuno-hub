import {expect,it} from "vitest";
import {resolveBroadcast} from "./broadcast-model";
const ticket=(id:string,status:string,date:string)=>({id,status,lastMessageAt:date,senderEmail:"wa-group:123@g.us",senderName:"Grupo",subject:"Grupo",assignedTo:null});
it("resolves a saved client/contact to its current ticket without duplicating historical or closed calls",()=>{
 const result=resolveBroadcast([{clientId:"client",address:"wa-group:123@g.us"}],[{id:"client",name:"Cliente",serviceTickets:[ticket("old","RESOLVED","2026-11-24"),ticket("current","NEW","2026-11-25")]}]);
 expect(result.selections.map(r=>r.destination.id)).toEqual(["current"]);expect(result.unavailable).toBe(0);
});
it("does not silently substitute another contact or send to an unlinked client",()=>{
 const result=resolveBroadcast([{clientId:"client",address:"wa-group:other@g.us"},{clientId:"removed",address:"wa-group:123@g.us"}],[{id:"client",name:"Cliente",serviceTickets:[ticket("old","RESOLVED","2026-11-24")]}]);
 expect(result).toEqual({selections:[],unavailable:2});
});
