import { expect,it } from "vitest";
import {contactInput} from "./contact-input";
it("normalizes internationally qualified numbers and accepts official phone JIDs",()=>{
  expect(contactInput.parse({name:" Cliente ",number:"+55 (61) 99999-1234"})).toEqual({name:"Cliente",number:"5561999991234"});
  expect(contactInput.parse({name:"Cliente",number:"5561999991234@s.whatsapp.net"}).number).toBe("5561999991234");
});
it("never treats groups, LIDs, URLs or incomplete numbers as saveable phone contacts",()=>{
  for(const number of ["12345@g.us","123456789@lid","https://example.test","123","0000000000"]){expect(contactInput.safeParse({name:"Cliente",number}).success).toBe(false);}
});
