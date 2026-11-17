import {expect, it} from "vitest";
import {canEditNote, canDeleteNote, noteReactions, toggleNoteReaction} from "./note-model";
it("allows each participant to toggle or change only their own reaction", () => {
  const reactions = {other: "❤️", me: "👍"};
  expect(toggleNoteReaction(reactions, "me", "✅")).toEqual({other: "❤️", me: "✅"});
  expect(toggleNoteReaction(reactions, "me", "👍")).toEqual({other: "❤️"});
  expect(reactions.me).toBe("👍");
});
it("rejects arbitrary reaction payloads", () => {expect(() => toggleNoteReaction({}, "me", "invalid")).toThrow(); expect(noteReactions({bad: {html: "x"}, good: "✅"})).toEqual({good: "✅"});});
it("reserves editing for the author and deletion for the author or meeting manager", () => {
  expect(canEditNote("author", "manager")).toBe(false);
  expect(canDeleteNote("author", "manager", true)).toBe(true);
  expect(canDeleteNote("author", "other", false)).toBe(false);
  expect(canEditNote("author", "author")).toBe(true);
});
