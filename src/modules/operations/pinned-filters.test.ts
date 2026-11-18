import {expect,it} from "vitest";
import {captureActivityFilters,captureAnalyticsFilters,decodeActivityPinnedFilters,decodeAnalyticsPinnedFilters,pinnedFilterKey,restoreActivityFilters,restoreAnalyticsFilters,type ActivityFilters} from "./pinned-filters";
const filters:ActivityFilters={responsibleId:"",clientId:"client",processId:"process",status:"OPEN",team:"Elite do Fluxo",priority:"HIGH",cluster:"A",search:"Pagamento"};
const current={from:"2026-11-18",to:"2026-11-18",mine:true,pendingPrevious:false,filters};
it("restores Today relative to the next visit rather than freezing the pinned date",()=>{
 const pinned=captureActivityFilters(current,"2026-11-18");expect(pinned.period).toEqual({mode:"today"});expect(restoreActivityFilters(pinned,"2026-11-19")).toEqual({...current,from:"2026-11-19",to:"2026-11-19"});expect(decodeActivityPinnedFilters(JSON.stringify(pinned))).toEqual(pinned);
});
it("keeps tomorrow and next seven days relative across month and year boundaries",()=>{
 const tomorrow=captureActivityFilters({...current,from:"2026-12-01",to:"2026-12-01"},"2026-11-30");expect(restoreActivityFilters(tomorrow,"2026-12-31")).toMatchObject({from:"2027-01-01",to:"2027-01-01"});
 const next7=captureActivityFilters({...current,to:"2026-11-24"},"2026-11-18");expect(restoreActivityFilters(next7,"2026-12-29")).toMatchObject({from:"2026-12-29",to:"2027-01-04"});
});
it("preserves custom periods, all chosen criteria and the prior-pending view",()=>{
 const custom={...current,from:"2026-10-01",to:"2026-10-31",pendingPrevious:true};expect(restoreActivityFilters(captureActivityFilters(custom,"2026-11-18"),"2027-02-01")).toEqual(custom);
});
it("separates preferences by organization, user and operation tab",()=>{
 expect(pinnedFilterKey("org:user","activities")).not.toBe(pinnedFilterKey("org:other","activities"));expect(pinnedFilterKey("org:user","activities")).not.toBe(pinnedFilterKey("other:user","activities"));expect(pinnedFilterKey("org:user","activities")).not.toBe(pinnedFilterKey("org:user","analytics"));
});
it("ignores malformed, unsupported or invalid persisted criteria",()=>{
 const pinned=captureActivityFilters(current,"2026-11-18");for(const value of ["{","null",JSON.stringify({...pinned,version:2}),JSON.stringify({...pinned,period:{mode:"custom",from:"2026-02-30",to:"2026-03-01"}}),JSON.stringify({...pinned,filters:{...filters,status:"OTHER"}})])expect(decodeActivityPinnedFilters(value)).toBeNull();expect(decodeAnalyticsPinnedFilters(JSON.stringify(pinned))).toBeNull();
});
it("restores analytics month and previous-month presets relative to the current date",()=>{
 const base={from:"2026-11-01",to:"2026-11-18",preset:"month",filters:{clientId:"client",operatorId:"operator",processId:"",team:"",cluster:"" as const}};
 expect(restoreAnalyticsFilters(captureAnalyticsFilters(base),"2026-12-03")).toMatchObject({from:"2026-12-01",to:"2026-12-03",preset:"month",filters:base.filters});
 expect(restoreAnalyticsFilters(captureAnalyticsFilters({...base,preset:"previous"}),"2027-01-03")).toMatchObject({from:"2026-12-01",to:"2026-12-31"});expect(decodeAnalyticsPinnedFilters(JSON.stringify(captureAnalyticsFilters(base)))).not.toBeNull();
});
it("keeps custom analytics dates fixed while rolling the last seven or thirty days",()=>{
 const base={from:"2026-10-01",to:"2026-10-31",preset:"custom",filters:{clientId:"",operatorId:"",processId:"",team:"",cluster:"" as const}};
 expect(restoreAnalyticsFilters(captureAnalyticsFilters(base),"2027-01-10")).toMatchObject({from:base.from,to:base.to});expect(restoreAnalyticsFilters(captureAnalyticsFilters({...base,preset:"week"}),"2027-01-03")).toMatchObject({from:"2026-12-28",to:"2027-01-03"});
});
