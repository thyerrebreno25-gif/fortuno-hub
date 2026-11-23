import { expect, it } from "vitest";
import { TIMER_REVIEW_MS, timerReviewDue } from "./timer-reminder-policy";
const start = "2026-11-23T12:00:00Z", now = Date.parse(start) + TIMER_REVIEW_MS;
it("prompts at 45 minutes only while the current session is running", () => {
  expect(timerReviewDue(true, start, now - 1)).toBe(false);
  expect(timerReviewDue(true, start, now)).toBe(true);
  expect(timerReviewDue(false, start, now + 60000)).toBe(false);
  expect(timerReviewDue(true, null, now)).toBe(false);
});
it("keeps the activity running with another prompt after the acknowledged period", () => {
  expect(timerReviewDue(true, start, now + 1, now + TIMER_REVIEW_MS)).toBe(false);
  expect(timerReviewDue(true, start, now + TIMER_REVIEW_MS, now + TIMER_REVIEW_MS)).toBe(true);
});
