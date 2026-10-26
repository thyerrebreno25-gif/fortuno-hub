"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Group, Loader, Modal, Paper, PasswordInput, ScrollArea, Select, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import styles from "./notion.module.css";

type Item = { id: string; kind: string; title: string; url?: string; editedAt?: string; properties?: Record<string, string> };
type Block = { id: string; type: string; text: string; checked: boolean; hasChildren: boolean };
type Status = { connection: { botName: string; workspaceName: string; checkedAt: string } | null; canManage: boolean; configured: boolean };
type Detail = { item: Item; items?: Item[]; columns?: string[]; sources?: Item[]; blocks?: Block[]; cursor: string | null };
async function request<T>(params: Record<string, string>, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/integrations/notion?${new URLSearchParams(params)}`, { ...init, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Não foi possível consultar o Notion.");
  return data;
}
export function NotionPage() {
  const [status, setStatus] = useState<Status | null>(null), [error, setError] = useState("");
  const [token, setToken] = useState(""), [connectOpen, setConnectOpen] = useState(false), [disconnectOpen, setDisconnectOpen] = useState(false), [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(""), [kind, setKind] = useState("all"), [items, setItems] = useState<Item[]>([]), [cursor, setCursor] = useState<string | null>(null), [loading, setLoading] = useState(false);
  const [active, setActive] = useState<Item | null>(null), [detail, setDetail] = useState<Detail | null>(null), [detailLoading, setDetailLoading] = useState(false), [detailError, setDetailError] = useState(""), [trail, setTrail] = useState<Item[]>([]);
  const searchVersion = useRef(0), detailVersion = useRef(0);
  const loadStatus = useCallback(async () => {
    try { setStatus(await request<Status>({ view: "status" })); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao carregar integração."); }
  }, []);
  useEffect(() => { void Promise.resolve().then(loadStatus); }, [loadStatus]);
  const search = useCallback(async (next?: string) => {
    const version = ++searchVersion.current;
    setLoading(true); setError("");
    try {
      const result = await request<{ items: Item[]; cursor: string | null }>({ view: "search", query, kind, ...(next ? { cursor: next } : {}) });
      if (version === searchVersion.current) { setItems((previous) => next ? [...previous, ...result.items.filter((item) => !previous.some((old) => old.id === item.id))] : result.items); setCursor(result.cursor); }
    } catch (cause) { if (version === searchVersion.current) setError(cause instanceof Error ? cause.message : "Falha na busca."); }
    finally { if (version === searchVersion.current) setLoading(false); }
  }, [query, kind]);
  useEffect(() => {
    if (!status?.connection) return;
    const timer = window.setTimeout(() => void search(), 350);
    return () => window.clearTimeout(timer);
  }, [status?.connection, search]);
  async function open(item: Item, next?: string, ancestry: Item[] = []) {
    const version = ++detailVersion.current;
    setActive(item); setTrail(ancestry); setDetailLoading(true); setDetailError("");
    if (!next) setDetail(null);
    try {
      const view = item.kind === "data_source" ? "data_source" : item.kind === "database" ? "database" : item.kind === "block" ? "blocks" : "page";
      let result = await request<Detail>({ view, id: item.id, ...(next ? { cursor: next } : {}) });
      if (view === "page") result = { ...result, ...await request<{ blocks: Block[]; cursor: string | null }>({ view: "blocks", id: item.id, ...(next ? { cursor: next } : {}) }) };
      if (view === "blocks") result.item = item;
      if (version === detailVersion.current) setDetail((previous) => next && previous ? { ...result, item: result.item || previous.item, ...(result.blocks ? { blocks: [...(previous.blocks || []), ...result.blocks] } : {}), ...(result.items ? { items: [...(previous.items || []), ...result.items] } : {}) } : result);
    } catch (cause) { if (version === detailVersion.current) setDetailError(cause instanceof Error ? cause.message : "Falha ao abrir conteúdo."); }
    finally { if (version === detailVersion.current) setDetailLoading(false); }
  }
  async function connect() {
    setBusy(true);
    try {
      await request({}, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      searchVersion.current++; detailVersion.current++;
      setToken(""); setConnectOpen(false); setDetail(null); setActive(null); setItems([]);
      await loadStatus(); notifications.show({ color: "green", message: "Notion conectado. Consulte as páginas e bases compartilhadas." });
    } catch (cause) { notifications.show({ color: "red", message: cause instanceof Error ? cause.message : "Falha ao conectar." }); }
    finally { setBusy(false); }
  }
  async function disconnect() {
    setBusy(true);
    try {
      await request({}, { method: "DELETE" });
      searchVersion.current++; detailVersion.current++;
      setStatus((previous) => previous ? { ...previous, connection: null } : previous); setItems([]); setActive(null); setDetail(null); setCursor(null); setDisconnectOpen(false);
    } catch (cause) { notifications.show({ color: "red", message: cause instanceof Error ? cause.message : "Falha ao desconectar." }); }
    finally { setBusy(false); }
  }
  function child(item: Item) { void open(item, undefined, [...trail, active!]); }
  return <div className={styles.page}>
    <div className={styles.hero}><Group justify="space-between"><div><Text size="xs" c="blue" fw={800}>CONHECIMENTO DA EQUIPE</Text><Title order={2}>Notion</Title><Text size="sm" c="dimmed">Páginas, bases e documentos acessíveis no Fortuno Hub.</Text></div><Badge color={status?.connection ? "green" : "gray"}>{status?.connection ? "Conectado" : "Não conectado"}</Badge></Group></div>
    {error && <Alert color="red">{error}</Alert>}
    {!status && !error && <Loader />}
    {status && <Paper withBorder p="lg" radius="lg"><Stack gap="sm"><Group justify="space-between"><div><Title order={4}>{status.connection?.workspaceName || "Conecte o workspace da equipe"}</Title><Text size="sm" c="dimmed">{status.connection ? `Integração: ${status.connection.botName}` : "Use o token da sua integração interna do Notion."}</Text></div>{status.canManage && <Group><Button disabled={!status.configured || busy} onClick={() => setConnectOpen(true)}>{status.connection ? "Trocar conexão" : "Conectar Notion"}</Button>{status.connection && <Button variant="subtle" color="red" disabled={busy} onClick={() => setDisconnectOpen(true)}>Desconectar</Button>}</Group>}</Group>
      {!status.configured && <Alert color="orange">A chave de criptografia das integrações precisa ser configurada pelo administrador.</Alert>}
      <Text size="sm">No Notion, abra a página ou base, clique em ••• → Conexões e adicione sua integração. Apenas o conteúdo autorizado será consultado.</Text>
      <Text size="xs" c="dimmed">Consulta somente de leitura. O conteúdo compartilhado fica disponível aos perfis com acesso ao módulo Notion no Hub.</Text>
      {!status.canManage && !status.connection && <Alert color="blue">Peça a um gestor para conectar o Notion.</Alert>}
    </Stack></Paper>}
    {status?.connection && <><Group><TextInput flex={1} miw={200} aria-label="Buscar no Notion" placeholder="Buscar páginas e bases pelo título…" value={query} onChange={(event) => setQuery(event.currentTarget.value)} /><Select aria-label="Tipo de conteúdo" w={160} value={kind} onChange={(value) => setKind(value || "all")} data={[{ value: "all", label: "Tudo" }, { value: "page", label: "Páginas" }, { value: "data_source", label: "Bases" }]} /><Button variant="default" loading={loading} onClick={() => void search()}>Atualizar</Button></Group>
      <div className={styles.explorer}><div className={styles.results}>{!items.length && !loading && <Alert color="blue">Nenhum resultado. Confira se as páginas foram compartilhadas com a integração. A busca é pelo título.</Alert>}{items.map((item) => <button key={item.id} className={styles.result} aria-pressed={active?.id === item.id} onClick={() => void open(item)}><Text size="xs" c="dimmed">{item.kind === "data_source" ? "BASE" : "PÁGINA"}</Text><Text fw={650} size="sm">{item.title}</Text></button>)}{loading && <Loader size="sm" />}{cursor && <Button variant="light" disabled={loading} onClick={() => void search(cursor)}>Carregar mais resultados</Button>}</div>
      <Paper withBorder radius="lg" p="lg" className={styles.detail}><Stack>{!active && <Text c="dimmed" ta="center" py={80}>Selecione uma página ou base para consultar.</Text>}{active && <><Group gap={6}>{trail.map((item, index) => <Button key={`${item.id}:${index}`} variant="subtle" size="xs" onClick={() => void open(item, undefined, trail.slice(0, index))}>{item.title} /</Button>)}</Group><Group justify="space-between"><Title order={3}>{detail?.item?.title || active.title}</Title>{detail?.item?.url && <Button size="xs" variant="default" component="a" href={detail.item.url} target="_blank" rel="noreferrer">Abrir no Notion ↗</Button>}</Group>{detailError && <Alert color="red">{detailError}<Button size="xs" variant="subtle" onClick={() => void open(active, undefined, trail)}>Tentar novamente</Button></Alert>}{detailLoading && <Loader size="sm" />}
        {detail && <>
          {active.kind === "page" && Object.keys(detail.item.properties || {}).length > 0 && <dl className={styles.properties}>{Object.entries(detail.item.properties || {}).map(([key, value]) => <div key={key} style={{ display: "contents" }}><dt>{key}</dt><dd>{value || "—"}</dd></div>)}</dl>}
          {detail.sources?.map((item) => <Button variant="light" key={item.id} onClick={() => child(item)}>{item.title || "Consultar base"}</Button>)}
          {detail.items && <ScrollArea><Table striped highlightOnHover><Table.Thead><Table.Tr>{(detail.columns || []).map((column) => <Table.Th key={column}>{column}</Table.Th>)}<Table.Th>Conteúdo</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{detail.items.map((row) => <Table.Tr key={row.id}>{(detail.columns || []).map((column) => <Table.Td key={column} style={{ maxWidth: 280, overflowWrap: "anywhere" }}>{row.properties?.[column] || "—"}</Table.Td>)}<Table.Td><Button variant="subtle" size="xs" onClick={() => child(row)}>Abrir página</Button></Table.Td></Table.Tr>)}</Table.Tbody></Table>{!detail.items.length && <Text size="sm" c="dimmed" py="md">Esta base não possui registros acessíveis.</Text>}</ScrollArea>}
          {detail.blocks?.map((block) => <div key={block.id} className={styles.block} data-type={block.type}>{block.type === "divider" ? <hr /> : <>{block.type === "to_do" ? (block.checked ? "☑ " : "☐ ") : block.type === "bulleted_list_item" ? "• " : block.type === "numbered_list_item" ? "– " : ""}{block.text || (block.hasChildren ? "Seção" : `[${block.type}]`)}</>}{(block.hasChildren || block.type === "child_page" || block.type === "child_database") && <Button size="compact-xs" variant="subtle" ml="xs" onClick={() => child({ id: block.id, kind: block.type === "child_database" ? "database" : block.type === "child_page" ? "page" : "block", title: block.text || "Seção" })}>Abrir conteúdo</Button>}</div>)}
          {detail.blocks?.length === 0 && <Text size="sm" c="dimmed">Página sem blocos de conteúdo acessíveis.</Text>}
          {detail.cursor && <Button variant="light" disabled={detailLoading} onClick={() => void open(active, detail.cursor!, trail)}>Carregar mais conteúdo</Button>}
        </>}
      </>}</Stack></Paper></div></>}
    <Modal opened={connectOpen} onClose={() => { if (!busy) { setConnectOpen(false); setToken(""); } }} title="Conectar Notion" centered><Stack><Text size="sm">Cole o token da integração interna. Ele será enviado ao servidor do Hub, validado no Notion e armazenado criptografado. Não será exibido novamente.</Text><PasswordInput label="Token da integração" autoComplete="new-password" value={token} onChange={(event) => setToken(event.currentTarget.value)} disabled={busy} /><Alert color="blue">Os perfis autorizados neste módulo poderão consultar o conteúdo compartilhado com esta integração.</Alert><Button loading={busy} disabled={token.trim().length < 20} onClick={() => void connect()}>Validar e conectar</Button></Stack></Modal>
    <Modal opened={disconnectOpen} onClose={() => !busy && setDisconnectOpen(false)} title="Desconectar Notion" centered><Stack><Text size="sm">A credencial será removida do Hub. As páginas e bases do Notion serão preservadas.</Text><Button color="red" loading={busy} onClick={() => void disconnect()}>Desconectar integração</Button></Stack></Modal>
  </div>;
}
