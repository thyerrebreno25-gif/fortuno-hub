import {expect,it} from "vitest";
import {groupPaymentRequests} from "./payment-groups";
it("groups requests across several conversations for the same client and keeps unlinked conversations separate",()=>{
 const row={clientId:"cl",clientName:"Cliente",ticketId:"one",senderName:"Grupo",status:"PENDING"};
 const result=groupPaymentRequests([row,{...row,ticketId:"two"},{...row,clientId:null,ticketId:"three"},{...row,clientId:null,ticketId:"four"}]);
 expect(result).toHaveLength(3);expect(result.find(group=>group.id==="cl")).toMatchObject({pending:2});
});
