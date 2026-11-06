import { expect, it } from "vitest";
import { summarizeClientLinks } from "./client-links";
const clients = [{ id: "a", name: "Cliente A", whatsappIdentities: [{ kind: "GROUP", externalId: "group@g.us", displayName: "Grupo" }, { kind: "CONTACT", externalId: "5511", displayName: "Contato" }] }, { id: "b", name: "Cliente B", whatsappIdentities: [] }];
it("counts a client once while retaining all linked groups and contacts", () => {
  const result = summarizeClientLinks(clients, [{ kind: "GROUP", externalId: "group@g.us", displayName: "Grupo de pagamentos" }, { kind: "CONTACT", externalId: "5511@s.whatsapp.net", displayName: "Contato financeiro" }], [{ id: "t", clientId: "a", senderEmail: "wa-group:other@g.us", senderName: "Outro grupo", subject: "Grupo" }, { id: "duplicate", clientId: "a", senderEmail: "wa-group:other@g.us", senderName: "Outro grupo", subject: "Grupo" }]);
  expect(result).toMatchObject({ total: 2, linked: 1, unlinked: 1, percentage: 50 }); expect(result.clients[0].links).toHaveLength(3); expect(result.clients[1].links).toEqual([]);
});
it("does not count old account identities absent from the current directory and tickets", () => { expect(summarizeClientLinks(clients, [], []).linked).toBe(0); });
it("avoids division by zero for an empty active base", () => expect(summarizeClientLinks([], [], []).percentage).toBe(0));
it("does not revive a previous client's link from an older resolved ticket", () => {
  const chat = { id: "new", clientId: "b", senderEmail: "wa-group:relinked@g.us", senderName: "Grupo", subject: "Grupo" };
  const result = summarizeClientLinks(clients, [], [chat, { ...chat, id: "old", clientId: "a" }]);
  expect(result.linked).toBe(1); expect(result.clients[0].links).toEqual([]); expect(result.clients[1].links).toHaveLength(1);
});
