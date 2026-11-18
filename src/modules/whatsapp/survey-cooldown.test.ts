import {expect,it} from "vitest";
import {surveyCooldownWhere} from "./survey-cooldown";

it("blocks any recent answer even if a newer unanswered invitation exists",()=>{
 const where=surveyCooldownWhere(15,new Date("2026-12-10T19:45:00Z"));
 expect(where.OR).toContainEqual({status:"ANSWERED",OR:[{answeredAt:{gt:new Date("2026-11-10T19:45:00Z")}},{answeredAt:null,OR:[{sentAt:{gt:new Date("2026-11-10T19:45:00Z")}},{sentAt:null,createdAt:{gt:new Date("2026-11-10T19:45:00Z")}}]}]});
 expect(where.OR?.[1]).toMatchObject({OR:[{sentAt:{gt:new Date("2026-11-25T19:45:00Z")}},{sentAt:null,createdAt:{gt:new Date("2026-11-25T19:45:00Z")}}]});
});
