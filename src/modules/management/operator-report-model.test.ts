import {expect,it} from "vitest";
import {googleChatWebhook,reportPeriod,reportChatMessages,type OperatorDayReport} from "./operator-report-model";
const row={userId:"ana",name:"Ana <users/all>",leader:"Gestor",messages:7,conversations:2,clients:1,resolved:2,openCalls:1,tasksCompleted:3,tasksPending:2,dailyCompleted:1,dailyPending:1,seconds:5400,openTimers:1};
const report:OperatorDayReport={day:"2026-11-23",generatedAt:"2026-11-24T11:00:00Z",scope:"Todos os operadores",available:{whatsapp:true,operations:true,daily:true},warnings:[],rows:[row]};
it("defaults to yesterday in Brasília and rejects today, future and invalid dates",()=>{
 expect(reportPeriod(undefined,new Date("2026-11-24T01:00:00Z")).from).toBe("2026-11-22");
 expect(reportPeriod("2026-11-23",new Date(report.generatedAt))).toMatchObject({start:new Date("2026-11-23T03:00:00Z"),end:new Date("2026-11-24T03:00:00Z")});
 for(const date of ["2026-11-24","2026-11-25","2026-02-30"])expect(()=>reportPeriod(date,new Date(report.generatedAt))).toThrow();
});
it("shows confirmed production separately from current pending work and never turns names into Google Chat mentions",()=>{
 const [text]=reportChatMessages(report);expect(text).toContain("01:30 h");expect(text).toContain("Pendências na geração");expect(text).toContain("7 mensagens enviadas");expect(text).toContain("cronômetro(s) aberto(s), fora do tempo confirmado");expect(text).not.toContain("<users/all>");
 const restricted=reportChatMessages({...report,available:{whatsapp:false,operations:false,daily:true}}).join("");expect(restricted).not.toContain("mensagens enviadas");expect(restricted).not.toContain("Tarefas:");
});
it("splits large reports into messages below Google's size limit at operator boundaries",()=>{
 const parts=reportChatMessages({...report,rows:Array.from({length:200},(_,index)=>({...row,userId:String(index),name:"Á".repeat(180)}))});
 expect(parts.length).toBeGreaterThan(1);for(const part of parts)expect(new TextEncoder().encode(part).length).toBeLessThan(32000);
 expect(parts.join("").match(/7 mensagens enviadas/g)).toHaveLength(200);
});
it("accepts only an HTTPS incoming webhook at the exact Google Chat host and route",()=>{
 expect(googleChatWebhook("https://chat.googleapis.com/v1/spaces/AAAA/messages?key=key&token=token")).toContain("chat.googleapis.com");
 for(const url of ["http://chat.googleapis.com/v1/spaces/AA/messages?key=x&token=y","https://chat.googleapis.com.evil.test/v1/spaces/AA/messages?key=x&token=y","https://user:pass@chat.googleapis.com/v1/spaces/AA/messages?key=x&token=y","https://chat.googleapis.com/v1/spaces/AA/messages?key=x","https://chat.googleapis.com/v1/spaces/AA/messages?key=x&token=y&redirect=evil"]){expect(()=>googleChatWebhook(url)).toThrow();}
});
