import { expect,it } from "vitest";
import { draftReviewDelay } from "./draft-review-timing";
it("reviews short drafts after a brief typing pause without a remote-request cooldown",()=>{
 expect(draftReviewDelay("olá tudo bem")).toBe(300);
 expect(draftReviewDelay("oi")).toBe(300);
 expect(draftReviewDelay("a")).toBeNull();
 expect(draftReviewDelay("123456789")).toBeNull();
 expect(draftReviewDelay("a".repeat(5001))).toBeNull();
});
