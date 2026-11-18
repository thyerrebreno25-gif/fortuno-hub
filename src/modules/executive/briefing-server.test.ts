import {beforeEach,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const m=vi.hoisted(()=>({raw:vi.fn(),activities:vi.fn(),live:vi.fn(),baseline:vi.fn()}));
vi.mock("@/lib/prisma",()=>({prisma:{$queryRaw:m.raw,operationActivity:{findMany:m.activities}}}));
vi.mock("@/modules/whatsapp/monitoring-live",()=>({liveMonitoringTickets:m.live}));
vi.mock("@/modules/whatsapp/operation-start",()=>({operationStartedAt:m.baseline}));
import {executiveBriefing} from "./briefing-server";
import type {ExecutiveData} from "./types";
import type {ExecutiveScope} from "./server";
const now=new Date("2026-11-18T15:00:00Z"),data={period:{key:"today"},operators:[{id:"a",name:"Ana"}]} as ExecutiveData;
const all:ExecutiveScope={onboarding:true,clients:true,whatsapp:true,email:true,support:true,operations:true,meetings:true,calendar:true,ca:true,finance:true,purchase:true,investment:true,contract:true};
beforeEach(()=>{vi.clearAllMocks();m.raw.mockResolvedValue([]);m.activities.mockResolvedValue([]);m.live.mockResolvedValue([]);m.baseline.mockResolvedValue(new Date("2026-11-01"));});
it("scopes every supplementary source and account, including Daily tasks and real confirmation evidence",async()=>{
 await executiveBriefing("org",data,all,true,"account","5511",now);
 for(const [query] of m.raw.mock.calls)expect(query.values).toContain("org");
 const money=m.raw.mock.calls.find(([q])=>q.sql.includes('WITH briefing_money'))![0];
 expect(money.sql).toContain("creationConfirmedAt");expect(money.sql).toContain("d.status='SENT'");expect(money.sql).toContain("jsonb_typeof");
 const survey=m.raw.mock.calls.find(([q])=>q.sql.includes('FROM "WhatsAppSurvey"'))![0];expect(survey.values).toContain("account");expect(survey.sql).not.toContain("comment");
 const daily=m.raw.mock.calls.find(([q])=>q.sql.includes('GROUP BY a."responsibleId"'))![0];expect(daily.sql).toContain("'Daily','Semanal de squad'");expect(daily.sql).toContain('m."deletedAt" IS NULL');
 expect(m.live).toHaveBeenCalledWith("org","account","5511",new Date("2026-11-01"));
});
it("counts ad-hoc work due today and never classifies today's tasks as overdue",async()=>{
 m.activities.mockResolvedValue([{id:"task",title:"Ad hoc",status:"OPEN",scheduledDate:null,createdAt:new Date("2026-10-01"),dueAt:new Date("2026-11-18T12:00:00Z"),completedAt:null,responsibleId:"a",team:null,subjectToFine:false,clientCluster:"C",client:{id:"c",name:"Cliente",cluster:"C"},process:{id:"p",name:"Processo"},responsible:{id:"a",name:"Ana",email:"a@test"}}]);
 const result=await executiveBriefing("org",data,all,true,"account","5511",now);
 expect(result.workload[0]).toMatchObject({open:1,onTime:1,overdue:0});
});
it("does not query restricted modules or copy customer message contents into the TV payload",async()=>{
 const none=Object.fromEntries(Object.keys(all).map(key=>[key,false])) as ExecutiveScope;
 const empty=await executiveBriefing("org",data,none,false,null,null,now);expect(m.raw).not.toHaveBeenCalled();expect(m.activities).not.toHaveBeenCalled();expect(m.live).not.toHaveBeenCalled();expect(empty.satisfaction.average).toBeNull();
 m.live.mockResolvedValue([{id:"t",contact:"Contato",client:"Cliente",clientId:"c",assigneeId:"a",assignee:"Ana",status:"IN_PROGRESS",receivedAt:new Date("2026-11-18T10:00:00Z"),assignedAt:null,firstResponseAt:null,pendingSince:new Date("2026-11-18T10:00:00Z"),lastMessageAt:now,lastMessageId:"msg",pendingText:"URGENTE dados privados"}]);
 const result=await executiveBriefing("org",data,all,true,"account","5511",now);
 expect(result.attention[0]).toMatchObject({id:"t",severity:"CRITICAL"});expect(JSON.stringify(result)).not.toContain("dados privados");expect(()=>JSON.stringify(result)).not.toThrow();
});
it("keeps supplementary fan-out inside the two-connection budget",async()=>{
 let active=0,peak=0;m.raw.mockImplementation(async()=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,2));active--;return [];});
 await executiveBriefing("org",data,all,true,"account","5511",now);expect(peak).toBeLessThanOrEqual(2);
});
it("serializes recorded durations and daily totals without leaking BigInt into the API",async()=>{
 m.raw.mockImplementation(async(q:{sql:string})=>q.sql.includes('FROM "OperationTimeEntry"')?[{id:"a",seconds:5400,entries:2n}]:q.sql.includes('GROUP BY a."responsibleId"')?[{id:"a",open:3n,overdue:1n,completed:5n}]:[]);
 const result=await executiveBriefing("org",data,all,true,"account","5511",now);
 expect(result.time).toMatchObject({seconds:5400,entries:2});expect(result.daily).toMatchObject({open:3,overdue:1,completed:5});expect(()=>JSON.stringify(result)).not.toThrow();
 const timer=m.raw.mock.calls.find(([q])=>q.sql.includes('FROM "OperationTimeEntry"'))![0];expect(timer.sql).toContain('LEAST(');expect(timer.sql).toContain('::timestamp');
});
