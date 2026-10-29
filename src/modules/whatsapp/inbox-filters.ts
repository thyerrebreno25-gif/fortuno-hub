import type { Prisma } from "@/generated/prisma/client";
export type InboxView = "GENERAL" | "MINE" | "QUEUE";
export type InboxKind = "ALL" | "GROUP" | "CONTACT";
export type InboxStatus = "ALL" | "OPEN" | "RESOLVED";
export type InboxFilters = { view: InboxView; kind: InboxKind; status: InboxStatus };
type MetricTicket = { assignedToId: string | null; senderEmail: string; status: string };
export function inboxWhere(filters: InboxFilters, userId: string): Prisma.ServiceTicketWhereInput {
  const AND: Prisma.ServiceTicketWhereInput[] = [];
  if (filters.view === "MINE") AND.push({ assignedToId: userId });
  if (filters.view === "QUEUE") AND.push({ assignedToId: null, status: { notIn: ["RESOLVED", "SPAM"] } });
  if (filters.kind !== "ALL") AND.push({ senderEmail: { startsWith: filters.kind === "GROUP" ? "wa-group:" : "wa-contact:" } });
  if (filters.status === "OPEN") AND.push({ status: { notIn: ["RESOLVED", "SPAM"] } });
  if (filters.status === "RESOLVED") AND.push({ status: "RESOLVED" });
  return { AND };
}
export function inboxFacets(tickets: MetricTicket[], filters: InboxFilters, userId: string) {
  const count = (current: InboxFilters) => tickets.filter((ticket) =>
    ticket.status !== "SPAM" &&
    (current.view !== "MINE" || ticket.assignedToId === userId) &&
    (current.view !== "QUEUE" || !ticket.assignedToId && ticket.status !== "RESOLVED") &&
    (current.kind === "ALL" || ticket.senderEmail.startsWith(current.kind === "GROUP" ? "wa-group:" : "wa-contact:")) &&
    (current.status === "ALL" || (current.status === "RESOLVED" ? ticket.status === "RESOLVED" : ticket.status !== "RESOLVED"))
  ).length;
  return {
    view: { GENERAL: count({ ...filters, view: "GENERAL" }), MINE: count({ ...filters, view: "MINE" }), QUEUE: count({ ...filters, view: "QUEUE" }) },
    kind: { ALL: count({ ...filters, kind: "ALL" }), GROUP: count({ ...filters, kind: "GROUP" }), CONTACT: count({ ...filters, kind: "CONTACT" }) },
    status: { ALL: count({ ...filters, status: "ALL" }), OPEN: count({ ...filters, status: "OPEN" }), RESOLVED: count({ ...filters, status: "RESOLVED" }) },
  };
}
