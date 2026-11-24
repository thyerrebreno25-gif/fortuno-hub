import {describe, expect, it} from "vitest";
import {dailyDeadlineEditAllowed, dailyManagers, dailyScope, nextBusinessDeadline, dailyTeamWhere} from "./daily-model";
describe("Daily deadlines", () => {
  it("skips the weekend and configured holidays while preserving the São Paulo deadline time", () => {
    expect(nextBusinessDeadline(new Date("2026-11-20T09:30:15.123-03:00"), ["2026-11-23"]).toISOString()).toBe("2026-11-24T12:30:15.123Z");
    expect(nextBusinessDeadline(new Date("2026-12-31T23:55:00-03:00"), ["2027-01-01"]).toISOString()).toBe("2027-01-05T02:55:00.000Z");
  });
  it("does not grant a fresh grace day based on when a delayed worker happens to run", () => {
    expect(nextBusinessDeadline(new Date("2026-11-06T18:00:00-03:00")).toISOString()).toBe("2026-11-09T21:00:00.000Z");
  });
  it("rejects further postponement after the one extension and after an overdue original deadline", () => {
    const now = new Date("2026-11-20T15:00:00Z"), dueAt = new Date("2026-11-20T12:00:00Z"), proposed = new Date("2026-11-25T12:00:00Z");
    expect(dailyDeadlineEditAllowed("Daily", {dueAt, autoExtendedAt: null}, proposed, now)).toBe(false);
    expect(dailyDeadlineEditAllowed("Daily", {dueAt: proposed, autoExtendedAt: now}, new Date("2026-11-26T12:00:00Z"), now)).toBe(false);
    expect(dailyDeadlineEditAllowed("Daily", {dueAt: proposed, autoExtendedAt: now}, dueAt, now)).toBe(true);
    expect(dailyDeadlineEditAllowed("Semanal de squad", {dueAt, autoExtendedAt: null}, proposed, now)).toBe(true);
  });
  it("never lets an operator expand the request to other people's activities", () => {
    expect(dailyScope({organizationId: "org", userId: "me", role: "OPERATOR"}, true)).toMatchObject({responsibleId: "me", meeting: {organizationId: "org", deletedAt: null}});
    expect(dailyScope({organizationId: "org", userId: "me", role: "MASTER"}, true)).not.toHaveProperty("responsibleId");
  });
  it("restricts managers to themselves and their configured direct collaborators",()=>{
    const where=dailyScope({id:"manager-member",organizationId:"org",userId:"manager",role:"MANAGER"},true);
    expect(where).toMatchObject({responsible:{memberships:{some:{organizationId:"org",OR:[{userId:"manager"},{teamLeaderId:"manager-member"}]}}}});
    const missing=dailyScope({organizationId:"org",userId:"manager",role:"MANAGER"},true);expect(missing).toMatchObject({responsible:{memberships:{some:{OR:[{userId:"manager"}]}}}});
    expect(dailyScope({id:"admin-member",organizationId:"org",userId:"admin",role:"ADMIN"},true)).not.toHaveProperty("responsible");
  });
  it("alerts the direct leader and the meeting's manager, with management fallback", () => {
    const members = [{id: "lead", userId: "l", role: "MANAGER"}, {id: "boss", userId: "b", role: "MASTER"}, {id: "operator", userId: "o", role: "OPERATOR"}];
    expect(dailyManagers(members, "lead", "b").map(person => person.id)).toEqual(["lead", "boss"]);
    expect(dailyManagers(members, null, "o").map(person => person.id)).toEqual(["lead", "boss"]);
  });
  it("matches named Daily teams including historical accent and spelling variants",()=>{
    expect(dailyTeamWhere("Elite do Fluxo")).toEqual({AND:[{title:{contains:"Elite",mode:"insensitive"}},{title:{contains:"Fluxo",mode:"insensitive"}}]});
    expect(dailyTeamWhere("Força Tática Financeira")).toEqual({AND:[{OR:[{title:{contains:"Força",mode:"insensitive"}},{title:{contains:"Forca",mode:"insensitive"}}]},{OR:[{title:{contains:"Tática",mode:"insensitive"}},{title:{contains:"Tatica",mode:"insensitive"}},{title:{contains:"Tatitca",mode:"insensitive"}}]}]});
    expect(dailyTeamWhere("")).toEqual({});
  });
});
