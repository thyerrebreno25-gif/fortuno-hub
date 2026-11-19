import {z} from "zod";
const ids=z.array(z.string().min(1).max(100)).min(1).max(1500).refine(items=>new Set(items).size===items.length,"Selecione atividades sem repetições.");
export const transferActivityInput=z.discriminatedUnion("action",[
 z.object({action:z.literal("preview"),activityIds:ids}),
 z.object({action:z.literal("confirm"),responsibleId:z.string().min(1).max(100),reason:z.string().trim().max(1000).default(""),activities:z.array(z.object({id:z.string().min(1).max(100),updatedAt:z.string().datetime()})).min(1).max(1500).refine(items=>new Set(items.map(item=>item.id)).size===items.length)}),
]);
export type ActivityTransfer=Extract<z.infer<typeof transferActivityInput>,{action:"confirm"}>;
export const transferableStatuses=["OPEN","IN_PROGRESS","PAUSED","BLOCKED"] as const;
