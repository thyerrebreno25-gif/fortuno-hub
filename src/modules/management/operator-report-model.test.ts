import {expect,it} from "vitest";
import {reportPeriod,reportChatMessages,type OperatorDayReport} from "./operator-report-model";
it("defaults to yesterday in Brasília and rejects today, future and invalid dates",()=>{
 expect(reportPeriod(undefined,new Date("2026-11-24T01:00:00Z")).from).toBe("2026-11-22");expect(reportPeriod("2026-11-23",new Date("2026-11-24T11:00Z"))).toMatchObject({start:new Date("2026-11-23T03:00Z"),end:new Date("2026-11-24T03:00Z")});
 for(const date of ["2026-11-24","2026-11-25","2026-02-30"])expect(()=>reportPeriod(date,new Date("2026-11-24T11:00Z"))).toThrow();
});
it("sends only one short greeting referring to the attached PDF, without operator data in the message",()=>{
 const report={day:"2026-11-24",rows:Array.from({length:200},()=>({name:"Ana <users/all>",messages:12345}))} as OperatorDayReport;
 const messages=reportChatMessages(report);expect(messages).toHaveLength(1);expect(messages[0]).toContain("Bom dia, equipe de gestão!");expect(messages[0]).toContain("Segue em anexo o relatório diário de 24/11/2026");expect(messages[0]).toContain("Fortuno Hub");expect(messages[0]).not.toContain("12345");expect(messages[0]).not.toContain("<users/all>");expect(messages[0].length).toBeLessThan(500);
});
