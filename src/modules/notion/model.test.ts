import { expect, it } from "vitest";
import { notionBlock, notionItem, notionQuery, propertyPathId, propertyText, safeNotionUrl } from "./model";
it("extracts titles and properties without rendering Notion content as HTML", () => {
  const result = notionItem({ id: "p", object: "page", url: "javascript:alert(1)", properties: { Nome: { type: "title", title: [{ plain_text: "<script>texto</script>" }] }, Status: { type: "status", status: { name: "Concluído" } } } });
  expect(result.title).toBe("<script>texto</script>"); expect(result.url).toBe(""); expect(result.properties.Status).toBe("Concluído");
});
it("searches title and trade name across the source, combined with its status filter", () => {
  const source = { properties: { "Razão Social": { type: "title" }, "Nome Fantasia": { type: "rich_text" }, Aviso: { type: "status", status: { options: [{ name: "Pendência" }] } } } };
  expect(notionQuery(source, { query: "Jadlog", filterField: "Aviso", filterValue: "Pendência", direction: "ascending" })).toEqual({ filter: { and: [{ or: [{ property: "Razão Social", title: { contains: "Jadlog" } }, { property: "Nome Fantasia", rich_text: { contains: "Jadlog" } }] }, { property: "Aviso", status: { equals: "Pendência" } }] }, sorts: [{ property: "Razão Social", direction: "ascending" }] });
  expect(() => notionQuery(source, { query: "", filterField: "Inexistente", filterValue: "x", direction: "ascending" })).toThrow();
});
it("preserves relation metadata and colored selections for the client drawer", () => {
  const item = notionItem({ properties: { Acessos: { id: "abc", type: "relation", relation: [{ id: "page" }], has_more: true }, Squad: { id: "def", type: "select", select: { name: "Equipe A", color: "blue" } } } });
  expect(item.fields.Acessos).toMatchObject({ propertyId: "abc", type: "relation", relationCount: 1, hasMore: true });
  expect(item.fields.Squad.values[0]).toMatchObject({ label: "Equipe A", color: "blue" });
});
it("keeps linked pages navigable without accepting arbitrary URLs as IDs", () => {
  const block = notionBlock({ id: "block", type: "link_to_page", link_to_page: { type: "page_id", page_id: "page" } });
  expect(block).toMatchObject({ targetId: "page", targetKind: "page" });
});
it("does not double-encode Notion property IDs", () => {
  expect(propertyPathId("f%5C%5C%3Ap")).toBe("f%5C%5C%3Ap");
  expect(propertyPathId("a/b")).toBe("a%2Fb");
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
