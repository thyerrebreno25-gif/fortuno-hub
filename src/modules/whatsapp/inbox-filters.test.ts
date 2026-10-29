import { describe, expect, it } from "vitest";
import { inboxFacets, inboxWhere } from "./inbox-filters";
const tickets = [
  { assignedToId: "me", senderEmail: "wa-group:a", status: "IN_PROGRESS" },
  { assignedToId: "me", senderEmail: "wa-group:b", status: "RESOLVED" },
  { assignedToId: "other", senderEmail: "wa-contact:1", status: "IN_PROGRESS" },
  { assignedToId: null, senderEmail: "wa-group:c", status: "NEW" },
  { assignedToId: null, senderEmail: "wa-contact:2", status: "RESOLVED" },
  { assignedToId: null, senderEmail: "wa-group:d", status: "SPAM" },
];
describe("Combinable WhatsApp sidebar filters", () => {
  it("keeps owner, group and resolved conditions together", () => {
    const where = inboxWhere({ view: "MINE", kind: "GROUP", status: "RESOLVED" }, "me");
    expect(where.AND).toEqual([{ assignedToId: "me" }, { senderEmail: { startsWith: "wa-group:" } }, { status: "RESOLVED" }]);
  });
  it("counts closed groups belonging to the operator", () => {
    const facets = inboxFacets(tickets, { view: "MINE", kind: "GROUP", status: "RESOLVED" }, "me");
    expect(facets.view.MINE).toBe(1); expect(facets.kind.CONTACT).toBe(0); expect(facets.status).toEqual({ ALL: 2, OPEN: 1, RESOLVED: 1 });
  });
  it("keeps resolved and spam conversations outside the waiting queue", () => {
    const facets = inboxFacets(tickets, { view: "QUEUE", kind: "ALL", status: "ALL" }, "me");
    expect(facets.kind.ALL).toBe(1); expect(facets.status.RESOLVED).toBe(0);
  });
  it("allows an operator to find their finalized conversations", () => {
    const where = inboxWhere({ view: "MINE", kind: "ALL", status: "RESOLVED" }, "me");
    expect(JSON.stringify(where)).not.toContain("notIn");
    expect(inboxFacets(tickets, { view: "GENERAL", kind: "ALL", status: "ALL" }, "me").status).toEqual({ ALL: 5, OPEN: 3, RESOLVED: 2 });
  });
});
