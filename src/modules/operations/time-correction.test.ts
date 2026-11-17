import { expect, it } from "vitest";
import { brazilDateTimeInput, brazilDateTimeIso, correctionDates, correctionInterval, timeCorrectionSchema } from "./time-correction";
const now = new Date("2026-11-17T18:00:00Z");
it("records Brazilian wall times independently of the browser timezone, retaining seconds", () => {
  expect(brazilDateTimeInput("2026-11-17T02:12:31Z")).toBe("2026-11-16T23:12:31");
  expect(brazilDateTimeIso("2026-11-16T23:12:31")).toBe("2026-11-17T02:12:31.000Z");
  expect(correctionInterval({ startedAt: "2026-11-16T23:30:00-03:00", endedAt: "2026-11-17T00:10:15-03:00" }, now).seconds).toBe(2415);
});
it("rejects future, reversed and invalid periods and allows an existing period to be zeroed", () => {
  for (const [start, end] of [["bad", "bad"], ["2026-11-17T12:00:00Z", "2026-11-17T11:00:00Z"], ["2026-11-17T18:00:00Z", "2026-11-17T19:00:00Z"]]) expect(() => correctionInterval({ startedAt: start, endedAt: end }, now)).toThrow();
  expect(correctionInterval({ startedAt: now.toISOString(), endedAt: now.toISOString() }, now).seconds).toBe(0);
});
it("requires a reason and version for edits, or a stable UUID for missing-time additions", () => {
  const input = { startedAt: "2026-11-17T12:00:00Z", endedAt: "2026-11-17T13:00:00Z", reason: "Esqueci de iniciar" };
  expect(timeCorrectionSchema.safeParse(input).success).toBe(false);
  expect(timeCorrectionSchema.safeParse({ ...input, entryId: "entry" }).success).toBe(false);
  expect(timeCorrectionSchema.safeParse({ ...input, entryId: "entry", expectedUpdatedAt: now.toISOString() }).success).toBe(true);
  expect(timeCorrectionSchema.safeParse({ ...input, newEntryId: "22c6f4cc-3cc8-479d-a5fb-24f9a05c7340" }).success).toBe(true);
  expect(timeCorrectionSchema.safeParse({ ...input, newEntryId: "22c6f4cc-3cc8-479d-a5fb-24f9a05c7340", reason: " " }).success).toBe(false);
});
it("preserves recorded milliseconds until a field changes, avoiding a phantom second when opening an existing timer", () => {
  const original = { startedAt: "2026-11-17T11:00:22.900Z", endedAt: "2026-11-17T11:14:00.100Z" };
  const fields = [brazilDateTimeInput(original.startedAt), brazilDateTimeInput(original.endedAt)];
  const untouched = correctionDates(fields[0], fields[1], original);
  expect(untouched).toEqual(original);
  expect(correctionInterval(untouched, now).seconds).toBe(817);
  expect(correctionDates(fields[0], "2026-11-17T08:10:00", original)).toEqual({ startedAt: original.startedAt, endedAt: "2026-11-17T11:10:00.000Z" });
  expect(correctionInterval(correctionDates(fields[0], fields[0], original), now).seconds).toBe(0);
});
