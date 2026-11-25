import {expect,it} from "vitest";
import {summarizeOperatorService,serviceMinutes,type ServiceOpenRow} from "./operator-service-attention";
const now=new Date("2026-11-25T11:00:00Z"),ago=(minutes:number)=>new Date(+now-minutes*60000);
const people=[{userId:"ana",name:"Ana",messages:7,resolved:0},{userId:"bia",name:"Bia",messages:0,resolved:0}];
const ticket=(id:string,extra:Partial<ServiceOpenRow>={}):ServiceOpenRow=>({id,userId:"ana",contact:"Grupo do cliente",client:"Cliente X",status:"IN_PROGRESS",openedAt:ago(600),lastOutboundAt:ago(120),pendingSince:null,...extra});
it("distinguishes unanswered requests, closure reviews and legitimate waiting for the customer",()=>{
 const result=summarizeOperatorService(people,[ticket("pending",{pendingSince:ago(90)}),ticket("review",{openedAt:ago(540)}),ticket("customer",{status:"WAITING_CUSTOMER",openedAt:ago(1800)})],[{userId:"ana",minutes:10},{userId:"ana",minutes:50}],now);
 expect(result.metrics.get("ana")).toMatchObject({openCalls:3,responseSamples:2,averageResponseMinutes:30,longestResponseMinutes:50,responseBreaches:1,waitingCalls:1,overdueResponses:1,longestWaitMinutes:90,longOpenCalls:2,closureReviewCalls:1,waitingCustomerCalls:1,averageOpenMinutes:980,longestOpenMinutes:1800});
 expect(result.attention.cases.map(row=>row.ticketId)).toEqual(["pending","review"]);expect(result.metrics.get("ana")!.alerts.join(" ")).toContain("Sem finalizações registradas no dia");expect(result.metrics.get("bia")!.alerts).toEqual([]);
});
it("keeps fresh replies, internal waits and waiting-customer states out of closure accusations",()=>{
 const result=summarizeOperatorService(people,[ticket("fresh",{openedAt:ago(60),lastOutboundAt:ago(10)}),ticket("internal",{status:"WAITING_INTERNAL"}),ticket("customer",{status:"WAITING_CUSTOMER"}),ticket("received",{status:"WAITING_CUSTOMER",pendingSince:ago(31)})],[],now);
 expect(result.metrics.get("ana")).toMatchObject({closureReviewCalls:0,responseSamples:0,averageResponseMinutes:null,longestResponseMinutes:null,waitingCustomerCalls:1,overdueResponses:1});expect(result.metrics.get("ana")!.alerts.join(" ")).not.toContain("Sem finalizações");expect(result.attention.cases.some(row=>row.ticketId==="fresh")).toBe(false);
});
it("honors reset references and never turns missing response samples into zero-delay performance",()=>{
 const result=summarizeOperatorService(people,[ticket("old",{openedAt:ago(20000),pendingSince:ago(10000)})],[],now,now);expect(result.metrics.get("ana")).toMatchObject({averageResponseMinutes:null,longestWaitMinutes:0,longestOpenMinutes:0,overdueResponses:0,longOpenCalls:0,closureReviewCalls:0});expect(result.attention.cases).toEqual([]);expect(serviceMinutes(null)).toBe("-");expect(serviceMinutes(125)).toBe("2h 05min");
});
it("scopes every row to permitted operators, aggregates before limiting details and ignores invalid measurements",()=>{
 const result=summarizeOperatorService(people,[ticket("outside",{userId:"other"}),ticket("future",{openedAt:ago(-5)}),...Array.from({length:25},(_,i)=>ticket(String(i),{pendingSince:ago(100+i)}))],[{userId:"other",minutes:999},{userId:"ana",minutes:NaN},{userId:"ana",minutes:-1}],now,null,true);expect(result.metrics.get("ana")!.overdueResponses).toBe(25);expect(result.attention).toMatchObject({totalCases:25,truncated:true});expect(result.attention.cases).toHaveLength(20);expect(result.attention.cases[0].waitingMinutes).toBe(124);expect(result.metrics.has("other")).toBe(false);expect(result.metrics.get("ana")!.responseSamples).toBe(0);
});
