import { z } from "zod";

const rating = z.number().int().min(1).max(5).nullable();
export const gutActivitySchema = z.object({
  id: z.string().min(1).max(100),
  title: z.string().trim().min(1, "Informe o nome de cada atividade GUT.").max(300),
  gravity: rating, urgency: rating, tendency: rating,
});
export const gutSchema = z.array(gutActivitySchema).max(200).superRefine((items, ctx) => {
  if (new Set(items.map((item) => item.id)).size !== items.length) ctx.addIssue({ code: "custom", message: "Há atividades GUT com identificadores repetidos." });
});
export type GutActivity = z.infer<typeof gutActivitySchema>;
export function gutScore(item: GutActivity) {
  if (item.gravity === null || item.urgency === null || item.tendency === null) return null;
  return item.gravity * item.urgency * item.tendency;
}
export function gutImpact(item: GutActivity) {
  const score = gutScore(item);
  return score === null ? null : score / 125 * 100;
}
export function rankGut(items: GutActivity[]) {
  return [...items].sort((a, b) => (gutScore(b) ?? -1) - (gutScore(a) ?? -1));
}
