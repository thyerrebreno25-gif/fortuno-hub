import {expect,it} from "vitest";
import {financialBriefing,satisfactionBriefing,type FinancialRow} from "./briefing";
it("keeps imported and confirmed amounts separate and sorts production by actual volume",()=>{
 const row:FinancialRow={stage:"IMPORT",day:"2026-11-18",clientId:"c",clientName:"Cliente",userId:"a",userName:"Ana",origin:"Nota",amount:100,count:1n};
 const result=financialBriefing([row,{...row,stage:"SEND",amount:100},{...row,stage:"SEND",userId:"b",userName:"Bia",amount:25,count:2n}]);
 expect(result).toMatchObject({importedAmount:100,sentAmount:125,imports:1,confirmed:3});
 expect(result.byUser.map(person=>person.name)).toEqual(["Bia","Ana"]);
 expect(result.byClient[0]).toMatchObject({importedAmount:100,sentAmount:125,confirmed:3});
 expect(result.daily).toEqual([{date:"2026-11-18",imports:1,confirmed:3,importedAmount:100,sentAmount:125}]);
 expect(()=>JSON.stringify(result)).not.toThrow();
});
it("computes weighted satisfaction and compares seven days with the preceding seven days",()=>{
 const result=satisfactionBriefing([{operatorId:"a",day:"2026-11-18",total:5,count:1},{operatorId:"b",day:"2026-11-17",total:12,count:3},{operatorId:"a",day:"2026-11-05",total:6,count:2}],"2026-11-01","2026-11-18",new Date("2026-11-18T15:00:00Z"));
 expect(result).toMatchObject({average:3.83,responses:6,recent:4.25,previous:3,delta:1.25});
 expect(result.byUser.find(row=>row.id==="a")).toMatchObject({responses:3,average:11/3});
 expect(result.daily.map(point=>point.value)).toEqual([3,4,5]);
});
it("leaves missing satisfaction and comparison unavailable instead of claiming a zero rating",()=>{
 const result=satisfactionBriefing([],"2026-11-18","2026-11-18",new Date("2026-11-18T15:00:00Z"));
 expect(result).toMatchObject({average:null,recent:null,previous:null,delta:null,responses:0});
});
