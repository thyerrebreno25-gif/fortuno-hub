import {expect,it} from "vitest";
import {finalizationNote} from "./finalization";
it("creates an internal note identifying the finisher and the Brasilia date and time",()=>{const data=finalizationNote("t",{userId:"u",user:{name:"Operadora",email:"u@test"}},new Date("2026-11-12T12:34:00Z"),"5511");expect(data).toMatchObject({direction:"INTERNAL",toEmails:[],providerMetadata:{accountPhone:"5511",finalizedById:"u"}});expect(data.textBody).toContain("Operadora");expect(data.textBody).toContain("09:34");expect(data.textBody).toContain("12/11/2026");});
