import {expect,it} from "vitest";
import {batchClientRecipient,type BatchDestination} from "./batch-recipients";
import {prepareBatchSchema} from "./batch-schema";
const ticket=(id:string,senderEmail:string,status="RESOLVED",lastMessageAt="2026-11-19T12:00:00Z"):BatchDestination=>({id,senderEmail,status,lastMessageAt,senderName:"Contato",subject:"Contato",assignedTo:null});
it("keeps a client once and collapses many historical tickets of the same linked contact",()=>{
 const row=batchClientRecipient({id:"client",name:"Cliente",serviceTickets:[ticket("old","wa-contact:5511"),ticket("new","wa-contact:5511","NEW"),ticket("alias","wa-contact:5511@s.whatsapp.net"),ticket("group","wa-group:123@g.us")]});
 expect(row.id).toBe("client");expect(row.destinations.map(item=>item.id)).toEqual(["new","group"]);
});
it("uses the current open conversation for a linked destination, then the newest closed history with deterministic ties",()=>{
 const row=batchClientRecipient({id:"client",name:"Cliente",serviceTickets:[ticket("closed","wa-group:123@g.us","RESOLVED","2026-11-19T15:00:00Z"),ticket("open","wa-group:123@g.us","IN_PROGRESS"),ticket("y","wa-contact:5522"),ticket("x","wa-contact:5522")]});
 expect(row.destinations.map(item=>item.id)).toEqual(["open","x"]);
});
it("keeps clients with equal display names separate by their actual client ID",()=>{
 const clients=["c1","c2"].map(id=>batchClientRecipient({id,name:"Mesmo nome",serviceTickets:[ticket(id,"wa-contact:"+id)]}));
 expect(clients.map(client=>client.id)).toEqual(["c1","c2"]);
});
it("requires one reviewed destination per client and keeps compatibility with older browser tabs",()=>{
 const base={action:"prepare",batchId:"2c2f6ab6-e537-4b9e-9038-7415f492381b",content:"Olá!"};
 expect(prepareBatchSchema.parse({...base,recipients:[{clientId:"c",ticketId:"t"}]}).ticketIds).toEqual(["t"]);
 expect(prepareBatchSchema.safeParse({...base,recipients:[{clientId:"c",ticketId:"t1"},{clientId:"c",ticketId:"t2"}]}).success).toBe(false);
 expect(prepareBatchSchema.parse({...base,ticketIds:["legacy"]}).ticketIds).toEqual(["legacy"]);
});
