import {beforeEach,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const query=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/prisma",()=>({prisma:{$queryRaw:query}}));
// Reproduce Next's JSON cache boundary; a cache hit returns ISO strings.
vi.mock("next/cache",()=>({unstable_cache:(fn:()=>Promise<unknown>)=>async()=>JSON.parse(JSON.stringify(await fn()))}));
import {liveMonitoringTickets} from "./monitoring-live";
import {liveTicketRisk} from "./monitoring-insights";
beforeEach(()=>{vi.clearAllMocks();query.mockResolvedValue([]);});
it("scopes the live backlog to the current organization, phone and operation baseline independently of period filters",async()=>{
 const baseline=new Date("2026-11-16T00:00:00Z");await liveMonitoringTickets("org","wa-account:c:5511","5511",baseline,"client","operator");
 const sql=query.mock.calls[0][0];expect(sql.values).toEqual(expect.arrayContaining(["org","wa-account:c:5511","5511",baseline,"client","operator"]));expect(sql.sql).toContain('t."mergedIntoId" IS NULL');expect(sql.sql).toContain("NOT IN ('RESOLVED','SPAM')");expect(sql.sql).toContain("WHATSAPP_SURVEY");expect(sql.sql).toContain('MIN(m."receivedAt") OVER ()');expect(sql.sql).toContain("LIMIT 1001");
});
it("hydrates cached timestamp strings before measuring wait time and avoids disconnected lookups",async()=>{
 const now=new Date("2026-11-16T15:00:00Z");query.mockResolvedValue([{id:"t",contact:"Pessoa",client:"Cliente",assigneeId:null,assignee:"Na fila",status:"NEW",receivedAt:new Date("2026-11-16T14:00:00Z"),assignedAt:null,firstResponseAt:null,pendingSince:new Date("2026-11-16T14:00:00Z"),pendingText:"Urgente",lastMessageAt:now}]);
 const rows=await liveMonitoringTickets("org","wa-account:c:5511","5511",null);expect(rows[0].receivedAt).toBeInstanceOf(Date);expect(liveTicketRisk(rows[0],now).waitingMinutes).toBe(60);
 query.mockClear();expect(await liveMonitoringTickets("org",null,null,null)).toEqual([]);expect(query).not.toHaveBeenCalled();
});
