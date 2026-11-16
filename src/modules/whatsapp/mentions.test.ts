import {expect,it} from "vitest";import {mentionedNumbers} from "./mentions";
it("mentions only explicit phone tags in groups, with duplicates removed",()=>{expect(mentionedNumbers("Olá @5561999999999 e @5561888888888. @5561999999999","123@g.us")).toBe("5561999999999,5561888888888");expect(mentionedNumbers("financeiro@5561999999999.com @all", "123@g.us")).toBeUndefined();expect(mentionedNumbers("@5561999999999", "5561888888888")).toBeUndefined();});

import {namedMentions} from "./mentions";
it("keeps names in the draft and maps selected mentions anywhere in the text to the group member phone",()=>{
 const source="Bom dia, @João Silva. Pode verificar com @Brunna F.?";
 const result=namedMentions(source,[{phone:"5561999999999",name:"João Silva"},{phone:"5561888888888",name:"Brunna F."}],new Set(["5561999999999","5561888888888"]));
 expect(result.wireBody).toBe("Bom dia, @5561999999999. Pode verificar com @5561888888888?");expect(source).toContain("João Silva");expect(mentionedNumbers(result.wireBody,"123@g.us")).toBe("5561999999999,5561888888888");
});
it("does not tag an absent member or match part of a different name",()=>{
 expect(()=>namedMentions("Olá @Ana",[{phone:"5561999999999",name:"Ana"}],new Set())).toThrow("não está mais");
 expect(namedMentions("Olá @Ana Paula",[{phone:"5561999999999",name:"Ana Paula"},{phone:"5561888888888",name:"Ana"}],new Set(["5561999999999","5561888888888"])).wireBody).toBe("Olá @5561999999999");
});
