import { z } from "zod";
export const prepareBatchSchema = z.object({ action: z.literal("prepare"), batchId: z.uuid(), content: z.string().trim().min(1).max(5000), ticketIds: z.array(z.string().min(1).max(100)).min(1).max(50).refine(ids=>new Set(ids).size===ids.length) });
export const deliverBatchSchema = z.object({ action: z.literal("deliver"), deliveryId: z.string().min(1).max(100) });
