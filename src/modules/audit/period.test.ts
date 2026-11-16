import {describe,it,expect} from "vitest";
import {auditHistoryPeriod,auditDate} from "./period";
describe("histórico mínimo",()=>{
 it("cruza a virada do ano com três meses completos",()=>expect(auditHistoryPeriod("2026-01-15")).toEqual({start:"2025-10-01",end:"2025-12-31",months:3}));
 it("rejeita datas inexistentes e menos de três meses",()=>{expect(auditDate("2026-02-30")).toBeNull();expect(()=>auditHistoryPeriod("2026-03-01",2)).toThrow();});
});
