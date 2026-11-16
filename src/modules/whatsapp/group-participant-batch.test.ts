import { expect, it, vi } from "vitest";
import { addGroupParticipantBatch, type GroupParticipantBatchResult } from "./group-participant-batch";
const input = { action: "add" as const, participant: "5511999999999", requestId: "448e878d-cc2d-4bd0-a069-6907d3f79fb8" };
it("reports each group's outcome separately and continues after a refusal without retrying it", async () => {
  const send = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ error: "Sem permissão" }, { status: 403 })).mockResolvedValueOnce(Response.json({ ok: true, message: "Adicionado" }));
  const results: GroupParticipantBatchResult[] = [];
  await addGroupParticipantBatch([{ id: "directory:a", name: "Grupo A" }, { id: "b", name: "Grupo B" }], input, result => results.push(result), () => true, send);
  expect(results).toEqual([{ id: "directory:a", name: "Grupo A", ok: false, message: "Sem permissão" }, { id: "b", name: "Grupo B", ok: true, message: "Adicionado" }]);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[0][0]).toBe("/api/whatsapp/directory%3Aa/participants");
  for (const [, options] of send.mock.calls) expect(JSON.parse(options!.body as string)).toEqual(input);
});
it("keeps timeouts unconfirmed without automatic resend or losing later group results", async () => {
  const send = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce(Response.json({ ok: true, message: "Adicionado" }));
  const results: GroupParticipantBatchResult[] = [];
  await addGroupParticipantBatch([{ id: "a", name: "A" }, { id: "b", name: "B" }], input, result => results.push(result), () => true, send);
  expect(results.map(result => result.ok)).toEqual([false, true]);
  expect(results[0].message).toContain("Sem confirmação");
  expect(send).toHaveBeenCalledTimes(2);
});
it("stops scheduling new changes when the screen is closed", async () => {
  let active = true;
  const send = vi.fn<typeof fetch>().mockImplementationOnce(async () => { active = false; return Response.json({ ok: true }); });
  const result = vi.fn();
  await addGroupParticipantBatch([{ id: "a", name: "A" }, { id: "b", name: "B" }], input, result, () => active, send);
  expect(send).toHaveBeenCalledOnce();expect(result).not.toHaveBeenCalled();
});
