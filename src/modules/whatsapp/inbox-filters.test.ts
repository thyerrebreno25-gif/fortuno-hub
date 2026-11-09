import { describe, expect, it } from "vitest";
import { inboxFacets, inboxWhere, matchesInboxFilters } from "./inbox-filters";
const tickets = [
  { assignedToId: "me", senderEmail: "wa-group:a", status: "IN_PROGRESS" },
  { assignedToId: "me", senderEmail: "wa-group:b", status: "RESOLVED" },
  { assignedToId: "other", senderEmail: "wa-contact:1", status: "IN_PROGRESS" },
  { assignedToId: null, senderEmail: "wa-group:c", status: "NEW" },
  { assignedToId: null, senderEmail: "wa-contact:2", status: "RESOLVED" },
  { assignedToId: null, senderEmail: "wa-group:d", status: "SPAM" },
];
describe("Combinable WhatsApp sidebar filters", () => {
  it("keeps the personal inbox active even with the ALL status filter", () => {
    expect(matchesInboxFilters(tickets[1],{view:"MINE",kind:"ALL",status:"ALL"},"me")).toBe(false);
    expect(inboxWhere({view:"MINE",kind:"GROUP",status:"ALL"},"me").AND).toEqual([{assignedToId:"me",status:{notIn:["RESOLVED","SPAM"]}},{senderEmail:{startsWith:"wa-group:"}}]);
    expect(inboxFacets(tickets,{view:"MINE",kind:"ALL",status:"ALL"},"me").view.MINE).toBe(1);
  });
  it("keeps resolved and spam conversations outside the waiting queue", () => {
    const facets = inboxFacets(tickets, { view: "QUEUE", kind: "ALL", status: "ALL" }, "me");
    expect(facets.kind.ALL).toBe(1); expect(facets.status.RESOLVED).toBe(0);
  });
  it("keeps finalized history in the general box and accepts a newly assigned call", () => {
    expect(matchesInboxFilters(tickets[1],{view:"GENERAL",kind:"ALL",status:"RESOLVED"},"me")).toBe(true);
    expect(matchesInboxFilters({...tickets[1],status:"NEW"},{view:"MINE",kind:"ALL",status:"ALL"},"me")).toBe(true);
    expect(matchesInboxFilters({...tickets[1],status:"NEW",assignedToId:"other"},{view:"MINE",kind:"ALL",status:"ALL"},"me")).toBe(false);
  });
});
