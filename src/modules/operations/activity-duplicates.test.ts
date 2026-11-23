import { expect, it } from "vitest";
import { activityDuplicateGroups } from "./activity-duplicates";
it("flags possible copies only inside the queried day and the same client, process and activity title", () => {
  const row = { id: "a", clientId: "client", processId: "process", title: "Agendar pagamentos" };
  const result = activityDuplicateGroups([row, { ...row, id: "b", title: " AGENDAR  PAGAMENTOS " }, { ...row, id: "c", clientId: "other" }, { ...row, id: "d", processId: "other" }, { ...row, id: "e", title: "Conferir pagamentos" }]);
  expect([...result]).toEqual([["a", 2], ["b", 2]]);
});
