import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ find: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { serviceTicket: { findFirst: m.find } } }));
import { getWhatsappTicket, resolveWhatsappTicketId } from "./server";
beforeEach(() => vi.resetAllMocks());
describe("Merged ticket aliases", () => {
  it("resolves old links to the canonical conversation within the same organization", async () => {
    m.find.mockResolvedValueOnce({ mergedIntoId: "canonical" }).mockResolvedValueOnce({ mergedIntoId: null });
    expect(await resolveWhatsappTicketId("old", "org")).toBe("canonical");
    expect(m.find.mock.calls.map(call => call[0].where)).toEqual([
      { id: "old", organizationId: "org", source: { in: ["WHATSAPP_SIMULATOR", "WHATSAPP_API"] } },
      { id: "canonical", organizationId: "org", source: { in: ["WHATSAPP_SIMULATOR", "WHATSAPP_API"] } },
    ]);
  });
  it("returns the complete canonical payload and avoids an extra query for regular links", async () => {
    const canonical = { id: "canonical", mergedIntoId: null, messages: [{ id: "preserved" }] };
    m.find.mockResolvedValueOnce({ mergedIntoId: "canonical" }).mockResolvedValueOnce(canonical);
    expect(await getWhatsappTicket("old", "org")).toEqual(canonical);
    m.find.mockClear(); m.find.mockResolvedValue(canonical);
    expect(await getWhatsappTicket("canonical", "org")).toEqual(canonical); expect(m.find).toHaveBeenCalledOnce();
  });
  it("stops circular aliases", async () => {
    m.find.mockResolvedValue({ mergedIntoId: "old" });
    await expect(resolveWhatsappTicketId("old", "org")).rejects.toThrow("circular");
  });
});
