"use client";
import { useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Drawer, Group, Loader, Paper, Stack, Tabs, Text, Title } from "@mantine/core";
import { fieldColor, notionRequest, type Detail, type Field, type Item } from "./client";
import { SourceTable } from "./source-table";
import styles from "./notion.module.css";

function Related({ pageId, name, field, onOpen }: { pageId: string; name: string; field: Field; onOpen: (item: Item) => void }) {
  const [items, setItems] = useState<Item[] | null>(null), [cursor, setCursor] = useState<string | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState("");
  async function load(next?: string) {
    setLoading(true); setError("");
    try { const result = await notionRequest<{ items: Item[]; cursor: string | null }>({ view: "relation", id: pageId, property: field.propertyId, ...(next ? { cursor: next } : {}) }); setItems((previous) => next ? [...(previous || []), ...result.items] : result.items); setCursor(result.cursor); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao ler vínculos."); }
    finally { setLoading(false); }
  }
  return <Paper withBorder p="sm" radius="md"><Stack gap="xs"><Group justify="space-between"><Text size="sm" fw={650}>{name}</Text><Button size="xs" variant="light" loading={loading} onClick={() => void load()}>{items ? "Atualizar vínculos" : `Consultar ${field.relationCount}${field.hasMore ? "+" : ""} vínculo(s)`}</Button></Group>{error && <Alert color="orange">{error}</Alert>}{items?.map((item) => <Button key={item.id} variant="subtle" justify="flex-start" disabled={item.unavailable} onClick={() => onOpen(item)}>{item.title}</Button>)}{items?.length === 0 && <Text size="xs" c="dimmed">Nenhuma página relacionada acessível.</Text>}{cursor && <Button size="xs" loading={loading} onClick={() => void load(cursor)}>Mais vínculos</Button>}</Stack></Paper>;
}

export function PageDrawer({ item, onClose }: { item: Item | null; onClose: () => void }) {
  const [active, setActive] = useState<Item | null>(null), [trail, setTrail] = useState<Item[]>([]), [detail, setDetail] = useState<Detail | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState(""), [tab, setTab] = useState<string | null>("info");
  const version = useRef(0);
  async function open(target: Item, ancestry: Item[] = [], cursor?: string) {
    const current = ++version.current; setActive(target); setTrail(ancestry); setLoading(true); setError(""); if (!cursor) setDetail(null);
    try {
      const view = target.kind === "database" ? "database" : target.kind === "block" ? "blocks" : "page";
      let result = ["data_source", "saved_view"].includes(target.kind) ? { item: target, cursor: null } as Detail : await notionRequest<Detail>({ view, id: target.id, ...(cursor ? { cursor } : {}) });
      if (view === "page" && !["data_source", "saved_view"].includes(target.kind)) {
        if (current === version.current && !cursor) setDetail(result);
        result = { ...result, ...await notionRequest<{ blocks: NonNullable<Detail["blocks"]>; cursor: string | null }>({ view: "blocks", id: target.id, ...(cursor ? { cursor } : {}) }) };
      }
      if (view === "database" && result.sources?.length === 1) {
        const source = { ...result.sources[0], title: target.title };
        if (current === version.current) setActive(source);
        result = { item: source, cursor: null };
      }
      if (view === "blocks") result.item = target;
      if (current === version.current) setDetail((previous) => cursor && previous ? { ...result, blocks: [...(previous.blocks || []), ...(result.blocks || [])], sources: [...(previous.sources || []), ...(result.sources || [])] } : result);
    } catch (cause) { if (current === version.current) setError(cause instanceof Error ? cause.message : "Falha ao abrir ficha."); }
    finally { if (current === version.current) setLoading(false); }
  }
  useEffect(() => {
    let cancelled = false;
    if (item) void Promise.resolve().then(() => { if (!cancelled) { setTab("info"); void open(item); } });
    return () => { cancelled = true; };
  }, [item]);
  function child(target: Item) { setTab("content"); void open(target, [...trail, active!]); }
  const properties = detail?.item?.properties || {};
  const fields = detail?.item?.fields || {};
  const relations = Object.entries(fields).filter(([, field]) => field.type === "relation");
  const sections = detail?.blocks?.filter((block) => block.hasChildren || ["child_page", "child_database", "link_to_page"].includes(block.type)) || [];
  function section(block: (typeof sections)[number]) { child({ id: block.targetId || block.id, title: block.text || (block.type === "child_database" ? "Base de informações" : "Seção"), kind: block.targetKind || (block.type === "child_database" ? "database" : block.type === "child_page" ? "page" : "block") }); }
  const sectionList = <Stack gap="xs">{sections.map((block) => <Button key={block.id} variant="light" justify="space-between" fullWidth onClick={() => section(block)}>{block.text || (block.type === "child_database" ? "Base de informações" : "Abrir seção")} →</Button>)}{detail?.sources?.map((source) => <Button variant="light" key={source.id} onClick={() => child(source)}>{source.title || "Abrir lista"} →</Button>)}</Stack>;
  return <Drawer opened={Boolean(item)} onClose={() => { version.current++; onClose(); }} position="right" size="min(950px, 94vw)" title="Ficha do Notion" closeButtonProps={{ "aria-label": "Fechar ficha do Notion" }}><Stack>
    {active && <><Group gap={4}>{trail.map((parent, index) => <Button size="xs" variant="subtle" key={`${parent.id}:${index}`} onClick={() => { setTab("content"); void open(parent, trail.slice(0, index)); }}>{parent.title} /</Button>)}</Group><Group justify="space-between"><Title order={2}>{detail?.item.title || active.title}</Title>{detail?.item.url && <Button size="xs" variant="default" component="a" href={detail.item.url} target="_blank" rel="noreferrer">Abrir no Notion ↗</Button>}</Group></>}
    {error && <Alert color="red">{error}<Button size="xs" variant="subtle" onClick={() => active && void open(active, trail)}>Tentar novamente</Button></Alert>}{loading && <Loader size="sm" />}
    {detail && active && <Tabs value={tab} onChange={setTab}><Tabs.List><Tabs.Tab value="info">Informações</Tabs.Tab><Tabs.Tab value="content">Conteúdo e seções</Tabs.Tab><Tabs.Tab value="related">Vínculos {relations.length ? `(${relations.length})` : ""}</Tabs.Tab></Tabs.List>
      <Tabs.Panel value="info" pt="md"><Stack>{Object.keys(properties).length ? <dl className={styles.properties}>{Object.entries(properties).map(([name, value]) => <div key={name} style={{ display: "contents" }}><dt>{name}</dt><dd>{fields[name]?.values.length ? <Group gap={4}>{fields[name].values.map((option, index) => <Badge key={index} color={fieldColor(option.color)} tt="none">{option.label}</Badge>)}</Group> : fields[name]?.type === "relation" ? <Button size="compact-xs" variant="subtle" onClick={() => setTab("related")}>{value} →</Button> : value || "—"}</dd></div>)}</dl> : <Text size="sm" c="dimmed">Esta seção não possui propriedades de cadastro.</Text>}{sections.length > 0 && <><Text size="sm" fw={700}>Seções desta ficha</Text>{sectionList}</>}{["data_source", "saved_view"].includes(active.kind) && <Button onClick={() => setTab("content")}>Consultar registros da base</Button>}</Stack></Tabs.Panel>
      <Tabs.Panel value="content" pt="md"><Stack>{["data_source", "saved_view"].includes(active.kind) ? <SourceTable key={active.id} source={active} onPage={child} /> : <>{sectionList}{detail.blocks?.map((block) => <div key={block.id} className={styles.block} data-type={block.type}>{block.type === "divider" ? <hr /> : <>{block.type === "to_do" ? block.checked ? "☑ " : "☐ " : block.type === "bulleted_list_item" ? "• " : ""}{block.text || (block.hasChildren ? "Seção" : `[${block.type}]`)}</>}</div>)}{detail.blocks?.length === 0 && <Text size="sm" c="dimmed">Sem conteúdo acessível nesta seção.</Text>}{detail.cursor && <Button loading={loading} variant="light" onClick={() => void open(active, trail, detail.cursor!)}>Carregar mais conteúdo</Button>}</>}</Stack></Tabs.Panel>
      <Tabs.Panel value="related" pt="md"><Stack>{relations.map(([name, field]) => <Related key={`${active.id}:${field.propertyId}`} pageId={active.id} name={name} field={field} onOpen={child} />)}{!relations.length && <Text size="sm" c="dimmed">Nenhuma propriedade de vínculo nesta página. Subpáginas e listas ficam em Conteúdo e seções.</Text>}</Stack></Tabs.Panel>
    </Tabs>}
  </Stack></Drawer>;
}
