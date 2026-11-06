import { z } from "zod";
export const contactInput = z.object({ name: z.string().trim().min(1).max(150), number: z.string().trim().max(40).transform(value => value.replace(/@s\.whatsapp\.net$/, "").replace(/[+\s()\-]/g, "")).pipe(z.string().regex(/^[1-9]\d{7,14}$/, "Informe o número com DDI e DDD.")) });
