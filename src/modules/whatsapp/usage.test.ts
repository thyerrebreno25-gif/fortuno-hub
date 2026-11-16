import {expect,it} from "vitest";
import {whatsappUsagePeriod,whatsappUsageReport} from "./usage";
it("uses Sao Paulo day boundaries and rejects impossible or oversized periods",()=>{
 const period=whatsappUsagePeriod(null,null,new Date("2026-11-17T01:00:00Z"));expect(period.from).toBe("2026-11-01");expect(period.to).toBe("2026-11-16");expect(period.end.toISOString()).toBe("2026-11-17T03:00:00.000Z");
 expect(()=>whatsappUsagePeriod("2026-02-30","2026-03-01")).toThrow();expect(()=>whatsappUsagePeriod("2025-01-01","2026-11-01")).toThrow();expect(()=>whatsappUsagePeriod("2026-11-17","2026-11-16")).toThrow();
});
it("ranks actual recorded sends and includes colleagues with zero use",()=>{
 const base={comments:0,conversations:0,clients:0,activeDays:0,lastAt:null};
 const result=whatsappUsageReport([{...base,userId:"a",name:"Ana",messages:4,actions:10},{...base,userId:"b",name:"Bia",messages:6,actions:8},{...base,userId:"c",name:"Caio",messages:0,actions:0}]);
 expect(result.summary).toEqual({messages:10,actions:18,activeUsers:2,totalUsers:3});expect(result.rows.map(row=>[row.userId,row.share])).toEqual([["b",60],["a",40],["c",0]]);
 expect(whatsappUsageReport([{...base,userId:"x",name:"X",messages:0,actions:0}]).rows[0].share).toBe(0);
});
