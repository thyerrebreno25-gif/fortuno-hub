import {expect,it,vi} from "vitest";
vi.mock("@/lib/prisma",()=>({prisma:{}}));
import {columnsForRoutine,routineColumns,routineCellIndex,routineCellKey,routinePreset,routineColumnNeedsFrequency} from "./routine-matrix";
import type {ConfiguredRoutine} from "./routine-filters";
import {matchesRecurrence} from "./recurrence";
const agenda={id:"agenda",name:"Agenda de Pagamentos"},columns=routineColumns([agenda]);
function routine(patch:Partial<ConfiguredRoutine>={}):ConfiguredRoutine{return {id:"r",clientId:"client",processId:agenda.id,process:agenda,client:{id:"client",name:"Cliente",cluster:"A"},responsible:null,responsibleId:null,team:null,priority:"MEDIUM",createdAt:"2026-11-25T12:00:00Z",updatedAt:"2026-11-25T12:00:00Z",recurrenceType:"WEEKLY",recurrenceData:{weekdays:[1]},...patch};}
it("has all requested columns even without any configured routine or matching process",()=>{const cols=routineColumns([]);expect(cols.map(c=>c.id)).toEqual(["receipts","payments","agenda-1","agenda-2","agenda-3","agenda-4","agenda-5","monthly-audit","fortnight-audit","custom-agenda","report"]);});
it("keeps weekday agendas independent and exposes one multi-day routine in each covered cell",()=>{const monday=routine(),tuesday=routine({id:"tue",recurrenceData:{weekdays:[2]}}),both=routine({id:"both",recurrenceData:{weekdays:[1,3]}});const index=routineCellIndex([monday,tuesday,both],columns);expect(index.get(routineCellKey("client","agenda-1"))?.map(r=>r.id)).toEqual(["r","both"]);expect(index.get(routineCellKey("client","agenda-2"))?.map(r=>r.id)).toEqual(["tue"]);expect(index.get(routineCellKey("other","agenda-1"))).toBeUndefined();expect(index.get(routineCellKey("client","agenda-3"))?.[0]).toBe(both);});
it("does not misplace monthly agendas, weekend schedules or business-day coverage",()=>{expect(columnsForRoutine(routine({recurrenceType:"MONTHLY",recurrenceData:{monthDays:[5,20]}}),columns)).toEqual(["custom-agenda"]);expect(columnsForRoutine(routine({recurrenceData:{weekdays:[0,1]}}),columns)).toEqual(["agenda-1","custom-agenda"]);expect(columnsForRoutine(routine({recurrenceType:"DAILY",recurrenceData:{dailyMode:"BUSINESS_DAYS"}}),columns)).toEqual(["agenda-1","agenda-2","agenda-3","agenda-4","agenda-5"]);expect(columnsForRoutine(routine({recurrenceData:{weekdays:[1],monthDays:[25]}}),columns)).toEqual(["agenda-1"]);});
it("keeps custom sections persistent as distinct columns, including names resembling a built-in section",()=>{const custom={id:"extra",name:"Auditoria de impostos",department:"Rotinas configuradas"};const cols=routineColumns([agenda,custom,custom]);expect(cols.filter(c=>c.id==="process-extra")).toHaveLength(1);expect(columnsForRoutine(routine({processId:custom.id,process:custom}),cols)).toEqual(["process-extra"]);expect(columnsForRoutine(routine({processId:"a",process:{id:"a",name:"Auditoria Quinzenal"},recurrenceType:"MONTHLY",recurrenceData:{monthDays:[15,30]}}),cols)).toEqual(["fortnight-audit"]);});
it("presets generate on the selected weekday and anchor fortnightly intervals to the selected start",()=>{for(let weekday=1;weekday<=5;weekday++){const c=columns.find(c=>c.id===`agenda-${weekday}`)!;const preset=routinePreset(c,"2026-11-25");expect(columnsForRoutine(routine(preset),columns)).toEqual([c.id]);expect(matchesRecurrence(preset.recurrenceType,preset.recurrenceData,new Date("2026-11-30T12:00Z"))).toBe(weekday===1);}const preset=routinePreset(columns.find(c=>c.id==="fortnight-audit")!,"2026-11-01");expect(preset.recurrenceType).toBe("DAILY");expect(preset.recurrenceData.interval).toBe(15);expect(matchesRecurrence(preset.recurrenceType,preset.recurrenceData,new Date("2026-11-16T12:00Z"))).toBe(true);expect(matchesRecurrence(preset.recurrenceType,preset.recurrenceData,new Date("2026-11-15T12:00Z"))).toBe(false);});
it("uses the selected start for monthly returns, card invoices and audits",()=>{
 const processes=[{id:"yield",name:"Lançamento de Rendimento de Aplicação"},{id:"card",name:"Importação de Fatura de Cartão de Crédito"}],cols=routineColumns(processes);
 const yieldColumn=cols.find(c=>c.processId==="yield")!,cardColumn=cols.find(c=>c.processId==="card")!;
 expect(routineColumnNeedsFrequency(yieldColumn)).toBe(false);expect(routineColumnNeedsFrequency(cardColumn)).toBe(false);
 for(const column of [yieldColumn,cols.find(c=>c.id==="monthly-audit")!]){
  const schedule=routinePreset(column,"2026-12-01");expect(schedule.recurrenceData.startDate).toBe("2026-12-01");expect(schedule.recurrenceData.monthDays).toEqual([1]);
  expect(matchesRecurrence(schedule.recurrenceType,schedule.recurrenceData,new Date("2026-11-26T12:00Z"))).toBe(false);
  expect(matchesRecurrence(schedule.recurrenceType,schedule.recurrenceData,new Date("2026-12-01T12:00Z"))).toBe(true);
 }
 for(const column of [cardColumn,cols.find(c=>c.id==="fortnight-audit")!]){
  const schedule=routinePreset(column,"2026-12-16");expect(schedule.recurrenceData.interval).toBe(15);expect(schedule.recurrenceData.monthDays).toEqual([]);
  for(const day of ["2026-12-01","2026-12-15","2027-01-01","2027-02-01"])expect(matchesRecurrence(schedule.recurrenceType,schedule.recurrenceData,new Date(day+"T12:00Z"))).toBe(false);
  for(const day of ["2026-12-16","2026-12-31","2027-01-15"])expect(matchesRecurrence(schedule.recurrenceType,schedule.recurrenceData,new Date(day+"T12:00Z"))).toBe(true);
 }
});
it("applies an explicitly chosen monthly or fortnightly frequency to reports and other custom processes",()=>{
 for(const column of [columns.find(c=>c.id==="report")!,routineColumns([{id:"other",name:"Lançamento de Recebimento"}]).find(c=>c.processId==="other")!]){
  expect(routineColumnNeedsFrequency(column)).toBe(true);
  const monthly=routinePreset(column,"2026-12-07","MONTHLY"),fortnightly=routinePreset(column,"2026-12-07","FORTNIGHTLY");
  expect(monthly.recurrenceData.monthDays).toEqual([7]);expect(fortnightly.recurrenceData.interval).toBe(15);
  expect(matchesRecurrence(monthly.recurrenceType,monthly.recurrenceData,new Date("2027-01-07T12:00Z"))).toBe(true);
  expect(matchesRecurrence(fortnightly.recurrenceType,fortnightly.recurrenceData,new Date("2027-01-06T12:00Z"))).toBe(true);
  expect(matchesRecurrence(fortnightly.recurrenceType,fortnightly.recurrenceData,new Date("2027-01-07T12:00Z"))).toBe(false);
 }
});
