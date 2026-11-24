import { z } from "zod";
export const bulkActivityDeletionSchema = z.object({
  // Older date-based dialogs still send a day. A reviewed list selection may span days.
  day: z.string().optional(),
  reason: z.string().trim().min(5).max(2000),
  activities: z.array(z.object({ id: z.string().min(1).max(100), updatedAt: z.string().datetime({ offset: true }) })).min(1).max(2000),
}).refine(input => new Set(input.activities.map(activity => activity.id)).size === input.activities.length);
export type BulkActivityDeletion = z.infer<typeof bulkActivityDeletionSchema>;
export function selectedActivityDeletion(activities: Array<{id:string;updatedAt:string}>, reason: string): BulkActivityDeletion {
  return { reason, activities: activities.map(({id,updatedAt})=>({id,updatedAt})) };
}
export type BulkActivityPreview = { duplicateCount?: number; id: string; title: string; status: string; updatedAt: string; client: { name: string }; responsible: { name: string | null; email: string } | null };
