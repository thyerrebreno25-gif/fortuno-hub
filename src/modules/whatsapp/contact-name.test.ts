import {expect,it} from "vitest";
import {isContactName,messageSenderName} from "./contact-name";
it("uses known names instead of LIDs, phone identifiers and outbound contact ids",()=>{
 expect(isContactName("118670080606308@lid")).toBe(false);expect(isContactName("+55 (61) 99999-9999")).toBe(false);
 expect(isContactName("Vitor | EMBA")).toBe(true);
 expect(messageSenderName("118670080606308@lid","Vitor | EMBA",false)).toBe("Vitor | EMBA");
 expect(messageSenderName("118670080606308@lid","Vitor | EMBA",true)).toBe("Fortuno");
 expect(messageSenderName("Isabella Lago","Vitor | EMBA",true)).toBe("Isabella Lago");
});
