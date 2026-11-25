import {beforeEach,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));const m=vi.hoisted(()=>({query:vi.fn(),baseline:vi.fn(),reset:vi.fn()}));vi.mock("@/lib/prisma",()=>({prisma:{$queryRaw:m.query}}));vi.mock("@/modules/whatsapp/operation-start",()=>({operationStartedAt:m.baseline}));vi.mock("@/modules/whatsapp/attention-start",()=>({attentionStartedAt:m.reset}));
import {operatorServiceAttention} from "./operator-service-attention-server";
import {analyticsPeriod} from "@/modules/operations/analytics";
import type {OperatorDayRow} from "./operator-report-model";
const people=[{userId:"ana",name:"Ana",messages:2,resolved:0}] as OperatorDayRow[];
beforeEach(()=>{vi.clearAllMocks();m.query.mockResolvedValue([]);m.baseline.mockResolvedValue(new Date("2026-11-16T12:00Z"));m.reset.mockResolvedValue(null);});
it("scopes backlog and reply samples to organization, account, phone and allowed operators without selecting message text",async()=>{
 await operatorServiceAttention("org","wa-account:current:5511","5511",people,analyticsPeriod("2026-11-24","2026-11-24"),new Date("2026-11-25T11:00Z"));expect(m.query).toHaveBeenCalledTimes(2);
 for(const [query] of m.query.mock.calls){expect(query.values).toEqual(expect.arrayContaining(["org","wa-account:current:5511","5511","ana"]));expect(query.sql).toContain("'failed','unconfirmed'");expect(query.sql).toContain("WHATSAPP_SURVEY");expect(query.sql).toContain("reconciledEchoId");expect(query.sql).not.toContain('"textBody"');expect(query.sql).not.toContain('"htmlBody"');}
 expect(m.query.mock.calls[1][0].sql).toContain("WHATSAPP_RESOLVED");expect(m.query.mock.calls[1][0].sql).toContain('o."providerMetadata"->>\'userId\'');
});
it("reports source truncation even when most outgoing rows have no measurable reply burst",async()=>{
 m.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{userId:"",minutes:0,limited:true}]);const result=await operatorServiceAttention("org","account","5511",people,analyticsPeriod("2026-11-24","2026-11-24"),new Date("2026-11-25T11:00Z"));expect(result.attention.truncated).toBe(true);expect(result.metrics.get("ana")!.responseSamples).toBe(0);
});
