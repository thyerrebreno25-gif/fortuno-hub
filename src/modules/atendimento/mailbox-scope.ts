import type { Prisma } from "@/generated/prisma/client";
import { emailChannel } from "./email-channel";
import { activeMailbox, archivedMailbox } from "./mailbox-archive";
export const mailboxViews = ["GENERAL", "MINE", "TEAM", "UNASSIGNED", "WAITING", "RESOLVED", "SPAM", "ARCHIVED"];
export function mailboxScope(input: { organizationId: string; userId: string; canManage: boolean; view: string; assignedToId?: string; clientId?: string; search?: string }): Prisma.ServiceTicketWhereInput {
 const where: Prisma.ServiceTicketWhereInput = { organizationId: input.organizationId, ...emailChannel, ...(input.view === "ARCHIVED" ? archivedMailbox : activeMailbox) };
 if(input.view === "MINE") where.assignedToId = input.userId;
 else if(input.view === "UNASSIGNED") where.assignedToId = null;
 else if(input.assignedToId) where.assignedToId = input.assignedToId;
 else if(!input.canManage && input.view !== "GENERAL") where.assignedToId = input.userId;
 if(input.view === "MINE" || input.view === "UNASSIGNED") where.status = {notIn:["SPAM","RESOLVED"]};
 else if(input.view === "WAITING") where.status = {in:["WAITING_CUSTOMER","WAITING_INTERNAL"]};
 else if(input.view === "RESOLVED" || input.view === "SPAM") where.status = input.view === "SPAM" ? "SPAM" : "RESOLVED";
 else if(input.view !== "ARCHIVED") where.status = {not:"SPAM"};
 if(input.clientId) where.clientId = input.clientId === "UNIDENTIFIED" ? null : input.clientId;
 if(input.search) where.OR = [{subject:{contains:input.search,mode:"insensitive"}},{senderEmail:{contains:input.search,mode:"insensitive"}},{senderName:{contains:input.search,mode:"insensitive"}},{client:{name:{contains:input.search,mode:"insensitive"}}}];
 return where;
}
