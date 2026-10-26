"use client";
import { useEffect, useRef, useState } from "react";
import { Alert, Button, Group, Loader, Modal, Paper, Select, Stack, Text, TextInput } from "@mantine/core";
import { notionRequest, type Item } from "./client";
import { PageDrawer } from "./page-drawer";
import { SourceTable } from "./source-table";
import styles from "./notion.module.css";

export function NotionBrowser({ storageKey }: { storageKey: string }) {
  const [catalog, setCatalog] = useState<Item[]>([]), [catalogCursor, setCatalogCursor] = useState<string | null>(null), [catalogQuery, setCatalogQuery] = useState(""), [catalogLoading, setCatalogLoading] = useState(false), [error, setError] = useState("");
  const [source, setSource] = useState<Item | null>(null), [page, setPage] = useState<Item | null>(null);
  const [searchOpen, setSearchOpen] = useState(false), [query, setQuery] = useState(""), [results, setResults] = useState<Item[]>([]), [cursor, setCursor] = useState<string | null>(null), [loading, setLoading] = useState(false), [searchError, setSearchError] = useState("");
  const version = useRef(0), pageSearchVersion = useRef(0), sourceRef = useRef<Item | null>(null);
  function select(item: Item) {
    sourceRef.current = item; setSource(item);
    try { localStorage.setItem(storageKey, item.id); } catch { /* Browser storage may be disabled. */ }
  }
  async function catalogLoad(next?: string, search = catalogQuery) {
    const current = ++version.current; setCatalogLoading(true); setError("");
    try {
      const result = await notionRequest<{ items: Item[]; cursor: string | null }>({ view: "search", kind: "data_source", query: search, ...(next ? { cursor: next } : {}) });
      if (version.current !== current) return;
      setCatalog((previous) => next ? [...previous, ...result.items.filter((item) => !previous.some((old) => old.id === item.id))] : result.items); setCatalogCursor(result.cursor);
      if (!sourceRef.current && result.items.length) {
        let saved = ""; try { saved = localStorage.getItem(storageKey) || ""; } catch {}
        select(result.items.find((item) => item.id === saved) || result.items.find((item) => /client|fortun/i.test(item.title)) || result.items[0]);
      }
    } catch (cause) { if (current === version.current) setError(cause instanceof Error ? cause.message : "Falha ao carregar bases."); }
    finally { if (current === version.current) setCatalogLoading(false); }
  }
  useEffect(() => {
    const timer = window.setTimeout(() => void catalogLoad(undefined, catalogQuery), 450);
    return () => window.clearTimeout(timer);
    // catalogLoad uses a sequence counter and a ref for the selected base.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogQuery]);
  async function searchPages(next?: string) {
    const current = ++pageSearchVersion.current; setLoading(true); setSearchError("");
    try { const result = await notionRequest<{ items: Item[]; cursor: string | null }>({ view: "search", query, ...(next ? { cursor: next } : {}) }); if (current === pageSearchVersion.current) { setResults((previous) => next ? [...previous, ...result.items] : result.items); setCursor(result.cursor); } }
    catch (cause) { if (current === pageSearchVersion.current) setSearchError(cause instanceof Error ? cause.message : "Falha na busca."); }
    finally { if (current === pageSearchVersion.current) setLoading(false); }
  }
  const options = [...(source ? [source] : []), ...catalog.filter((item) => item.id !== source?.id)];
  return <Stack>
    <Paper withBorder p="md" radius="lg"><Group align="flex-end"><Select label="Base do Notion" description="Escolha a lista de clientes ou outro cadastro" placeholder="Pesquisar e selecionar uma base…" searchable searchValue={catalogQuery} onSearchChange={setCatalogQuery} value={source?.id || null} onChange={(value) => { const item = options.find((entry) => entry.id === value); if (item) select(item); }} data={options.map((item) => ({ value: item.id, label: item.title }))} flex={1} miw={250} rightSection={catalogLoading ? <Loader size={14} /> : undefined} /><Button variant="default" onClick={() => setSearchOpen(true)}>Buscar páginas e documentos</Button>{catalogCursor && <Button variant="light" loading={catalogLoading} onClick={() => void catalogLoad(catalogCursor)}>Mais bases</Button>}</Group></Paper>
    {error && <Alert color="red">{error}</Alert>}
    {!source && !catalogLoading && <Alert color="blue">Selecione uma base compartilhada com a integração para consultar os clientes. Outras páginas podem ser encontradas em Buscar páginas e documentos.</Alert>}
    {source && <SourceTable key={source.id} source={source} onPage={setPage} />}
    <PageDrawer item={page} onClose={() => setPage(null)} />
    <Modal opened={searchOpen} onClose={() => setSearchOpen(false)} title="Buscar páginas e documentos" size="lg"><Stack><Group><TextInput flex={1} aria-label="Título da página ou documento" placeholder="Buscar pelo título no Notion" value={query} onChange={(event) => setQuery(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchPages(); }} /><Button loading={loading} onClick={() => void searchPages()}>Buscar</Button></Group>{searchError && <Alert color="red">{searchError}</Alert>}<div className={styles.results}>{results.map((item) => <button className={styles.result} key={item.id} onClick={() => { setSearchOpen(false); if (item.kind === "data_source") select(item); else setPage(item); }}><Text size="xs" c="dimmed">{item.kind === "data_source" ? "Base" : "Página"}</Text><Text size="sm" fw={650}>{item.title}</Text></button>)}</div>{!results.length && !loading && <Text size="sm" c="dimmed">Busque pelo nome da página. Para localizar clientes por nome fantasia ou responsável, use os campos da base.</Text>}{cursor && <Button loading={loading} onClick={() => void searchPages(cursor)}>Carregar mais resultados</Button>}</Stack></Modal>
  </Stack>;
}
