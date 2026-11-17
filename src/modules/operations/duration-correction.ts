import { z } from "zod";

export const durationCorrectionSchema = z.object({
  mode: z.literal("duration"),
  requestId: z.string().uuid(),
  userId: z.string().min(1).max(100),
  seconds: z.number().int().min(0).max(2147483647),
  reason: z.string().trim().min(5).max(2000),
  expectedEntries: z.array(z.object({ id: z.string().min(1).max(100), updatedAt: z.string().datetime({ offset: true }) })).max(1000),
});
export type DurationCorrectionInput = z.infer<typeof durationCorrectionSchema>;

export function parseActivityDuration(value: string): number | null {
  const match = /^(\d{1,5}):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60;
  return seconds <= 2147483647 ? seconds : null;
}
export function durationLabel(seconds: number) {
  return `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, "0")}`;
}

/** Keep original work dates and distribute the corrected total without rounding losses. */
export function distributeDuration(total: number, weights: number[]) {
  if (!weights.length) return [];
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (!sum) return weights.map((_, index) => index === 0 ? total : 0);
  const result = weights.map(weight => Math.floor(total * Math.max(0, weight) / sum));
  const remainders = weights.map((weight, index) => ({ index, remainder: total * Math.max(0, weight) % sum })).sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  let left = total - result.reduce((a, b) => a + b, 0);
  for (const item of remainders) { if (!left--) break; result[item.index]++; }
  return result;
}
