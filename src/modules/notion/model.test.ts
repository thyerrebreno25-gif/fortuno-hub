import { expect, it } from "vitest";
import { notionBlock, notionItem, propertyText, safeNotionUrl } from "./model";
it("extracts titles and properties without rendering Notion content as HTML", () => {
  const result = notionItem({ id: "p", object: "page", url: "javascript:alert(1)", properties: { Nome: { type: "title", title: [{ plain_text: "<script>texto</script>" }] }, Status: { type: "status", status: { name: "Concluído" } } } });
  expect(result.title).toBe("<script>texto</script>"); expect(result.url).toBe(""); expect(result.properties.Status).toBe("Concluído");
});
it("supports current Notion links and rejects unrelated hosts", () => {
  expect(safeNotionUrl("https://app.notion.com/p/abc")).toBe("https://app.notion.com/p/abc");
  expect(safeNotionUrl("https://notion.so.evil.test/p/abc")).toBe("");
});
it("formats database fields including formulas, dates and multiple selections", () => {
  expect(propertyText({ type: "formula", formula: { type: "number", number: 42 } })).toBe("42");
  expect(propertyText({ type: "date", date: { start: "2026-10-26", end: "2026-10-27" } })).toBe("2026-10-26 → 2026-10-27");
  expect(propertyText({ type: "multi_select", multi_select: [{ name: "A" }, { name: "B" }] })).toBe("A, B");
});
it("keeps child blocks available for lazy reading and preserves checklist state", () => {
  expect(notionBlock({ id: "b", type: "to_do", has_children: true, to_do: { rich_text: [{ text: { content: "Revisar" } }], checked: true } })).toEqual({ id: "b", type: "to_do", text: "Revisar", checked: true, hasChildren: true });
});
