export const SERVICE_TICKET_STATUSES = [
  "NEW",
  "IN_PROGRESS",
  "WAITING_CUSTOMER",
  "WAITING_INTERNAL",
  "RESOLVED",
  "SPAM",
] as const;

export type ServiceTicketStatus =
  (typeof SERVICE_TICKET_STATUSES)[number];

export type ServiceInboxView =
  | "GENERAL"
  | "MINE"
  | "UNASSIGNED"
  | "WAITING"
  | "RESOLVED"
  | "SPAM";
