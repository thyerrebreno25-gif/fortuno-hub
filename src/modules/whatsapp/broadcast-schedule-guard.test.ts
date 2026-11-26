import {beforeEach,afterEach,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {guardScheduledDelivery} from "./broadcast-schedule-guard";
const query=vi.fn(),tx={$queryRaw:query} as never,actor={organizationId:"org",userId:"operator"},delivery={batchId:"job",ticketId:"ticket",body:"Frozen",accountRecipient:"account"},ticket={id:"ticket",clientId:"client",senderEmail:"wa-contact:5511"},execution={scheduleId:"job",leaseId:"lease"};
const job=()=>({id:"job",userId:"operator",body:"Frozen",accountRecipient:"account",target:{ticketId:"ticket",clientId:"client",address:"wa-contact:5511"},status:"RUNNING",leaseId:"lease",leaseUntil:new Date("2026-11-26T16:03Z"),scheduledAt:new Date("2026-11-26T16:00Z")});
beforeEach(()=>{vi.resetAllMocks();vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-26T16:00Z"));query.mockResolvedValueOnce([job()]).mockResolvedValueOnce([{id:"ticket"}]);});afterEach(()=>vi.useRealTimers());
it("blocks manual dispatch and stale or future worker claims before the provider is called",async()=>{
 expect(await guardScheduledDelivery(tx,delivery,actor,ticket)).toHaveProperty("blocked");
 for(const change of [{status:"CANCELLED"},{leaseId:"other"},{leaseUntil:new Date("2026-11-26T15:59Z")},{scheduledAt:new Date("2026-11-26T16:01Z")}]){query.mockReset();query.mockResolvedValueOnce([{...job(),...change}]);expect(await guardScheduledDelivery(tx,delivery,actor,ticket,execution)).toHaveProperty("blocked");}
});
it("cancels a changed client, body or physical destination instead of silently redirecting the broadcast",async()=>{
 expect(await guardScheduledDelivery(tx,delivery,actor,{...ticket,clientId:"other"},execution)).toHaveProperty("cancelled");
 query.mockReset();query.mockResolvedValueOnce([job()]);expect(await guardScheduledDelivery(tx,{...delivery,body:"Changed"},actor,ticket,execution)).toHaveProperty("cancelled");
 query.mockReset();query.mockResolvedValueOnce([job()]);expect(await guardScheduledDelivery(tx,delivery,actor,{...ticket,senderEmail:"wa-contact:other"},execution)).toHaveProperty("cancelled");
});
it("requires a currently active linked client and a valid worker lease",async()=>{
 expect(await guardScheduledDelivery(tx,delivery,actor,ticket,execution)).toBeNull();expect(query.mock.calls[0][0].sql).toContain("FOR UPDATE");expect(query.mock.calls[1][0].sql).toContain("c.active=true");
 query.mockReset();query.mockResolvedValueOnce([job()]).mockResolvedValueOnce([]);expect(await guardScheduledDelivery(tx,delivery,actor,ticket,execution)).toHaveProperty("cancelled");
});
