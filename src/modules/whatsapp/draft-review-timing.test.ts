import { expect,it } from "vitest";
import { draftReviewDelay } from "./draft-review-timing";
it("waits for a pause and spaces model requests rather than reviewing every keystroke",()=>{
 expect(draftReviewDelay("olá tudo bem",0,10000)).toBe(1500);
 expect(draftReviewDelay("olá tudo bem?",10000,11000)).toBe(7000);
 expect(draftReviewDelay("oi",0,10000)).toBeNull();
 expect(draftReviewDelay("123456789",0,10000)).toBeNull();
 expect(draftReviewDelay("a".repeat(5001),0,10000)).toBeNull();
});
