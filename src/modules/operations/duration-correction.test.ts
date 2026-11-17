import { expect, it } from "vitest";
import { distributeDuration, durationCorrectionSchema, durationLabel, parseActivityDuration } from "./duration-correction";
it("accepts duration in hours:minutes, including more than 24 hours, and rejects ambiguous values", () => {
  expect(parseActivityDuration("00:45")).toBe(2700);
  expect(parseActivityDuration("02:38")).toBe(9480);
  expect(parseActivityDuration("27:10")).toBe(97800);
  expect(parseActivityDuration("0:00")).toBe(0);
  for (const value of ["", "45", "02:75", "02:3", "-01:30", "2.38", "01:02:03"]) expect(parseActivityDuration(value)).toBeNull();
  expect(durationLabel(9480)).toBe("02:38");
});
it("replaces accumulated time across pause/resume segments without rounding losses", () => {
  expect(distributeDuration(2700, [600, 1200, 1800])).toEqual([450, 900, 1350]);
  expect(distributeDuration(2, [1, 1, 1])).toEqual([1, 1, 0]);
  expect(distributeDuration(9480, [0, 0])).toEqual([9480, 0]);
  expect(distributeDuration(0, [20, 30])).toEqual([0, 0]);
});
it("requires only duration, justification and an immutable snapshot, with no date fields", () => {
  const input = { mode: "duration", requestId: "22c6f4cc-3cc8-479d-a5fb-24f9a05c7340", userId: "u", seconds: 2700, reason: "Esqueci de iniciar", expectedEntries: [] };
  expect(durationCorrectionSchema.safeParse(input).success).toBe(true);
  for (const patch of [{ reason: " " }, { seconds: -1 }, { seconds: 1.5 }]) expect(durationCorrectionSchema.safeParse({ ...input, ...patch }).success).toBe(false);
});
