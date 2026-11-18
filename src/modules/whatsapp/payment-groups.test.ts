import {expect,it} from "vitest";
import {groupPaymentRequests,groupPaymentRequestsByTeam} from "./payment-groups";
it("groups requests across several conversations for the same client and keeps unlinked conversations separate",()=>{
 const row={clientId:"cl",clientName:"Cliente",ticketId:"one",senderName:"Grupo",status:"PENDING"};
 const result=groupPaymentRequests([row,{...row,ticketId:"two"},{...row,clientId:null,ticketId:"three"},{...row,clientId:null,ticketId:"four"}]);
 expect(result).toHaveLength(3);expect(result.find(group=>group.id==="cl")).toMatchObject({pending:2});
});
it("nests clients inside their registered team and combines legacy team spelling",()=>{
 const row={clientId:"one",clientName:"Cliente A",ticketId:"ticket-a",senderName:"Grupo A",status:"PENDING",clientTeam:"Elite do Fluxo"};
 const groups=groupPaymentRequestsByTeam([row,{...row,ticketId:"ticket-b",clientTeam:"ELITE DO FLUXO"},{...row,clientId:"two",clientName:"Cliente B",clientTeam:"Força Tatitca Financeira"},{...row,clientId:"three",clientName:"Cliente C",clientTeam:"Força Tática Financeira",status:"REVIEWED"}]);
 expect(groups).toHaveLength(2);
 expect(groups[0]).toMatchObject({name:"Elite do Fluxo",pending:2});
 expect(groups[0].clients).toHaveLength(1);expect(groups[0].clients[0].rows).toHaveLength(2);
 expect(groups[1]).toMatchObject({name:"Força Tática Financeira",pending:1});
 expect(groups[1].clients.map(client=>client.name)).toEqual(["Cliente B","Cliente C"]);
});
it("keeps clients without a team visible and falls back to an explicitly configured service squad",()=>{
 const row={clientId:null,clientName:null,ticketId:"a",senderName:"Contato A",clientTeam:null};
 const groups=groupPaymentRequestsByTeam([row,{...row,ticketId:"b",clientId:"cl",clientName:"Cliente",clientSquad:"SQUAD_2"}]);
 expect(groups.map(group=>group.name)).toEqual(["Equipe não definida","Squad 2"]);
 expect(groups[0].clients[0].rows[0].ticketId).toBe("a");
});
