import { expect, it } from "vitest";
import { displayMentions, hasNumericMention } from "./mention-display";
it("shows saved names for both phone numbers and LID mentions anywhere in the message", () => {
  const targets = [{ phone: "5561999999999", lid: "11867008060638@lid", name: "Vitor | EMBA" }];
  expect(displayMentions("Bom dia, @5561999999999. Pode conferir (@11867008060638)?", targets)).toBe("Bom dia, @Vitor | EMBA. Pode conferir (@Vitor | EMBA)?");
  expect(displayMentions("@11867008060638@lid", targets)).toBe("@Vitor | EMBA");
});
it("never rewrites emails, unrelated numbers, longer identifiers or invalid metadata", () => {
  const text = "email@5561999999999.com @5561888888888 @556199999999999999999";
  expect(displayMentions(text, [{ phone: "5561999999999", name: "Ana" }])).toBe(text);
  expect(displayMentions("@5561999999999", [{ phone: "5561999999999", name: "Ana\nOutra linha" }])).toBe("@5561999999999");
  expect(hasNumericMention("Bom dia @5561999999999!")).toBe(true);
  expect(hasNumericMention("email@5561999999999.com")).toBe(false);
});
it("preserves the name saved with a sent message over a later group name", () => expect(displayMentions("@5561999999999", [{ phone: "5561999999999", name: "Nome ao enviar" }, { phone: "5561999999999", name: "Nome atual" }])).toBe("@Nome ao enviar"));
