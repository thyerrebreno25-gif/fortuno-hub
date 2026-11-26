import {BROADCAST_RECIPIENT_LIMIT} from "./broadcast-policy";
import { z } from "zod";
const base={action:z.literal("prepare"),batchId:z.uuid(),content:z.string().trim().min(1).max(5000)};
const id=z.string().min(1).max(100);
export const prepareBatchSchema=z.union([
 z.object({...base,recipients:z.array(z.object({clientId:id,ticketId:id})).min(1).max(BROADCAST_RECIPIENT_LIMIT).refine(rows=>new Set(rows.map(row=>row.clientId)).size===rows.length&&new Set(rows.map(row=>row.ticketId)).size===rows.length)}),
 // Existing browser tabs can finish preparing without bypassing server-side client uniqueness.
 z.object({...base,ticketIds:z.array(id).min(1).max(BROADCAST_RECIPIENT_LIMIT).refine(ids=>new Set(ids).size===ids.length)}),
]).transform(data=>"recipients" in data?{...data,ticketIds:data.recipients.map(row=>row.ticketId)}:{...data,recipients:undefined});
export const deliverBatchSchema = z.object({ action: z.literal("deliver"), deliveryId: z.string().min(1).max(100) });
