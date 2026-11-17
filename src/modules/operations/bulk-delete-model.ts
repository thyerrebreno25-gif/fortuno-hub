import { z } from "zod";
export const bulkActivityDeletionSchema = z.object({
  day: z.string(),
  reason: z.string().trim().min(5).max(2000),
  activities: z.array(z.object({ id: z.string().min(1).max(100), updatedAt: z.string().datetime({ offset: true }) })).min(1).max(2000),
}).refine(input => new Set(input.activities.map(activity => activity.id)).size === input.activities.length);
export type BulkActivityDeletion = z.infer<typeof bulkActivityDeletionSchema>;
export type BulkActivityPreview = { id: string; title: string; status: string; updatedAt: string; client: { name: string }; responsible: { name: string | null; email: string } | null };
