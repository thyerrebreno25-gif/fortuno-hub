import {expect,it} from "vitest";
import {onboardingSummary,type OnboardingRow} from "./onboarding";
const start=new Date("2026-11-01T03:00:00Z"),end=new Date("2026-11-06T03:00:00Z"),now=new Date("2026-11-05T16:00:00Z");
const row=(patch:Partial<OnboardingRow>={}):OnboardingRow=>({id:"a",status:"IN_PROGRESS",risk:"ON_TIME",expectedEndDate:new Date("2026-11-15T12:00:00Z"),completedAt:null,companyName:"Empresa",responsibleName:"Isabella Lago",client:null,responsible:null,projectData:null,tasks:[],...patch});
const run=(rows:OnboardingRow[])=>onboardingSummary(rows,start,end,now);
it("reads current weighted stages without double counting legacy tasks",()=>{
 const result=run([row({tasks:[{status:"BLOCKED"}],projectData:{stages:[{weight:40,tasks:[{status:"COMPLETED"},{status:"NOT_APPLICABLE"}]},{weight:60,tasks:[{status:"COMPLETED"},{status:"WAITING_CLIENT"},{status:"BLOCKED"}]}]}})]);
 expect(result.projects[0]).toMatchObject({progress:60,pending:2,blocked:1,waiting:1});expect(result).toMatchObject({active:1,pendingTasks:2,blockedTasks:1,waitingClient:1,atRisk:1});
});
it("supports legacy relational tasks and excludes not applicable work",()=>{
 const result=run([row({tasks:[{status:"COMPLETED"},{status:"PENDING"},{status:"NOT_APPLICABLE"}]})]);expect(result.projects[0]).toMatchObject({progress:50,pending:1});
});
it("counts completions by actual completion period and ignores cancelled work",()=>{
 const result=run([row({id:"done",status:"COMPLETED",completedAt:start}),row({id:"old",status:"COMPLETED",completedAt:new Date("2026-10-31T12:00:00Z")}),row({id:"unknown",status:"COMPLETED"}),row({id:"cancelled",status:"CANCELLED",tasks:[{status:"BLOCKED"}]})]);expect(result).toMatchObject({active:0,completed:3,completedPeriod:1,pendingTasks:0,blockedTasks:0});expect(result.projects).toEqual([]);
});
it("uses the whole delivery date and separates overdue from attention",()=>{
 const result=run([row({id:"late",expectedEndDate:new Date("2026-11-04T12:00:00Z")}),row({id:"today",expectedEndDate:new Date("2026-11-05T00:00:00Z")}),row({id:"near",expectedEndDate:new Date("2026-11-08T12:00:00Z")}),row({id:"safe",expectedEndDate:new Date("2026-11-09T12:00:00Z")})]);expect(result).toMatchObject({active:4,overdue:1,atRisk:2});expect(result.projects.map(p=>p.risk)).toEqual(["OVERDUE","AT_RISK","AT_RISK","ON_TIME"]);
});
it("preserves named owners, unassigned projects and blocked work",()=>{
 const result=run([row({id:"one",tasks:[{status:"BLOCKED"}]}),row({id:"two",responsibleName:"isabella lago",tasks:[{status:"PENDING"}]}),row({id:"three",responsibleName:null})]);expect(result.responsibles).toHaveLength(2);expect(result.responsibles[0]).toMatchObject({name:"Isabella Lago",active:2,pending:2,blocked:1});expect(result.responsibles[1].active).toBe(1);
});
it("does not invent tasks from missing or malformed stages",()=>{const result=run([row({projectData:{stages:[null,{weight:100,tasks:null}]}})]);expect(result.projects[0]).toMatchObject({progress:0,pending:0});});
