"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Checkbox, Group, Loader, Paper, Popover, ScrollArea, Select, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { defaultColumns, fieldColor, notionRequest, type Detail, type Item } from "./client";
import styles from "./notion.module.css";

export function SourceTable({ source, onPage }: { source: Item; onPage: (item: Item) => void }) {
  const [data, setData] = useState<Detail | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [query, setQuery] = useState(""), [filterField, setFilterField] = useState<string | null>(null), [filterValue, setFilterValue] = useState(""), [sortField, setSortField] = useState<string | null>(null), [direction, setDirection] = useState("ascending"), [visible, setVisible] = useState<string[] | null>(null);
  const sequence = useRef(0);
  const load = useCallback(async (cursor?: string) => {
    const version = ++sequence.current; setLoading(true); setError("");
    try {
      const result = await notionRequest<Detail>({ view: "data_source", id: source.id, query, direction, ...(filterField && filterValue ? { filterField, filterValue } : {}), ...(sortField ? { sortField } : {}), ...(cursor ? { cursor } : {}) });
      if (version === sequence.current) setData((previous) => cursor && previous ? { ...result, items: [...(previous.items || []), ...(result.items || []).filter((item) => !previous.items?.some((old) => old.id === item.id))] } : result);
    } catch (cause) { if (version === sequence.current) setError(cause instanceof Error ? cause.message : "Falha ao consultar base."); }
    finally { if (version === sequence.current) setLoading(false); }
  }, [source.id, query, filterField, filterValue, sortField, direction]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 400); return () => window.clearTimeout(timer); }, [load]);
  const schema = data?.columnSchema || (data?.columns || []).map((name) => ({ name, type: "rich_text", options: [] }));
  const columns = visible === null ? defaultColumns(schema) : visible.filter((name) => schema.some((column) => column.name === name));
  const filter = schema.find((column) => column.name === filterField);
  return <Paper withBorder radius="lg" p="md" className={styles.sourcePanel}><Stack gap="sm">
    <Group justify="space-between"><div><Title order={4}>{data?.item.title && !/^(untitled|sem t[ií]tulo)$/i.test(data.item.title) ? data.item.title : source.title}</Title><Text size="xs" c="dimmed">{data?.items?.length || 0} registros carregados{data?.cursor ? " · há mais registros" : ""}. Clique em um cliente para abrir a ficha lateral.</Text></div><Button size="xs" variant="default" onClick={() => void load()} loading={loading}>Atualizar base</Button></Group>
    <TextInput aria-label="Buscar registros nesta base" placeholder="Buscar cliente, nome fantasia ou texto nesta base…" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
    <Group align="flex-end" gap="xs"><Select size="xs" label="Filtrar por" placeholder="Todas as situações" clearable value={filterField} onChange={(value) => { setFilterField(value); setFilterValue(""); }} data={schema.filter((column) => ["select", "status", "multi_select", "checkbox", "title", "rich_text", "email", "phone_number", "url"].includes(column.type)).map((column) => column.name)} w={180} searchable />
      {filter && (filter.type === "checkbox" || filter.options.length ? <Select size="xs" label="Valor do filtro" placeholder="Selecione" clearable value={filterValue || null} onChange={(value) => setFilterValue(value || "")} data={filter.type === "checkbox" ? [{ value: "true", label: "Sim" }, { value: "false", label: "Não" }] : filter.options.map((option) => ({ value: option.label, label: option.label }))} w={180} searchable /> : <TextInput size="xs" label="Valor do filtro" value={filterValue} onChange={(event) => setFilterValue(event.currentTarget.value)} w={180} />)}
      <Select size="xs" label="Ordenar por" placeholder="Nome do registro" clearable searchable value={sortField} onChange={setSortField} data={schema.filter((column) => ["title", "rich_text", "select", "status", "number", "date", "checkbox", "created_time", "last_edited_time", "email"].includes(column.type)).map((column) => column.name)} w={170} /><Select size="xs" label="Ordem" value={direction} onChange={(value) => setDirection(value || "ascending")} data={[{ value: "ascending", label: "Crescente" }, { value: "descending", label: "Decrescente" }]} w={130} />
      <Popover width={280} position="bottom-end" shadow="md"><Popover.Target><Button size="xs" variant="default" aria-label="Escolher colunas visíveis">Colunas ({columns.length})</Button></Popover.Target><Popover.Dropdown><ScrollArea mah={300}><Stack gap="xs">{schema.map((column) => <Checkbox key={column.name} size="xs" label={column.name} checked={columns.includes(column.name)} onChange={(event) => setVisible(event.currentTarget.checked ? [...columns, column.name] : columns.filter((name) => name !== column.name))} />)}</Stack></ScrollArea></Popover.Dropdown></Popover>
      {(query || filterField || sortField || direction !== "ascending") && <Button size="xs" variant="subtle" onClick={() => { setQuery(""); setFilterField(null); setFilterValue(""); setSortField(null); setDirection("ascending"); }}>Limpar filtros</Button>}
    </Group>
    {error && <Alert color="red">{error}</Alert>}
    {!data && loading && <Loader size="sm" />}
    {data && <ScrollArea mah="65vh" type="auto"><Table striped highlightOnHover className={styles.clientTable}><Table.Thead><Table.Tr>{columns.map((column) => <Table.Th key={column}>{column}</Table.Th>)}<Table.Th>Ficha</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{data.items?.map((row) => <Table.Tr key={row.id} onClick={() => onPage(row)}>{columns.map((column) => <Table.Td key={column}>{row.fields?.[column]?.values?.length ? <Group gap={4} wrap="nowrap">{row.fields[column].values.map((value, index) => <Badge key={index} color={fieldColor(value.color)} variant="light" tt="none" size="sm">{value.label || "—"}</Badge>)}</Group> : <span title={row.properties?.[column]}>{row.properties?.[column] || "—"}</span>}</Table.Td>)}<Table.Td><Button size="compact-xs" variant="subtle" aria-label={`Abrir ficha de ${row.title}`} onClick={(event) => { event.stopPropagation(); onPage(row); }}>Abrir ficha ↗</Button></Table.Td></Table.Tr>)}</Table.Tbody></Table></ScrollArea>}
    {data && !data.items?.length && !loading && <Text c="dimmed" size="sm" py="md">Nenhum registro corresponde à busca e aos filtros nesta base.</Text>}
    {data?.cursor && <Button variant="light" size="xs" loading={loading} onClick={() => void load(data.cursor!)}>Carregar mais registros</Button>}
  </Stack></Paper>;
}
