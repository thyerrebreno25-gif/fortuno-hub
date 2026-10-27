"use client";
import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Group, Loader, Modal, Paper, PasswordInput, Stack, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import styles from "./notion.module.css";
import { NotionBrowser } from "./browser";

type Status = { organizationId?: string; connection: { botName: string; workspaceName: string; checkedAt: string } | null; canManage: boolean; configured: boolean };
async function request<T>(params: Record<string, string>, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/integrations/notion?${new URLSearchParams(params)}`, { ...init, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Não foi possível consultar o Notion.");
  return data;
}
export function NotionPage() {
  const [status, setStatus] = useState<Status | null>(null), [error, setError] = useState("");
  const [token, setToken] = useState(""), [connectOpen, setConnectOpen] = useState(false), [disconnectOpen, setDisconnectOpen] = useState(false), [busy, setBusy] = useState(false);
  const [connectionDetails, setConnectionDetails] = useState(false);
  const loadStatus = useCallback(async () => {
    try { setStatus(await request<Status>({ view: "status" })); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao carregar integração."); }
  }, []);
  useEffect(() => { void Promise.resolve().then(loadStatus); }, [loadStatus]);
  async function connect() {
    setBusy(true);
    try {
      await request({}, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      setToken(""); setConnectOpen(false);
      await loadStatus(); notifications.show({ color: "green", message: "Notion conectado. Consulte as páginas e bases compartilhadas." });
    } catch (cause) { notifications.show({ color: "red", message: cause instanceof Error ? cause.message : "Falha ao conectar." }); }
    finally { setBusy(false); }
  }
  async function disconnect() {
    setBusy(true);
    try {
      await request({}, { method: "DELETE" });
      setStatus((previous) => previous ? { ...previous, connection: null } : previous); setDisconnectOpen(false);
    } catch (cause) { notifications.show({ color: "red", message: cause instanceof Error ? cause.message : "Falha ao desconectar." }); }
    finally { setBusy(false); }
  }
  return <div className={styles.page}>
    <div className={styles.hero}><Group justify="space-between"><div><Text size="xs" c="blue" fw={800}>CONHECIMENTO DA EQUIPE</Text><Title order={2}>Notion</Title></div><Badge color={status?.connection ? "green" : "gray"}>{status?.connection ? "Conectado" : "Não conectado"}</Badge></Group></div>
    {error && <Alert color="red">{error}</Alert>}
    {!status && !error && <Loader />}
    {status && <Paper withBorder p="lg" radius="lg"><Stack gap="sm"><Group justify="space-between"><div><Title order={4}>{status.connection?.workspaceName || "Conecte o workspace da equipe"}</Title><Text size="sm" c="dimmed">{status.connection ? `Integração: ${status.connection.botName}` : "Use o token da sua integração interna do Notion."}</Text></div>{status.canManage && <Group>{status.connection && <Button variant="subtle" size="xs" onClick={() => setConnectionDetails((value) => !value)}>{connectionDetails ? "Recolher detalhes" : "Detalhes da conexão"}</Button>}<Button disabled={!status.configured || busy} onClick={() => setConnectOpen(true)}>{status.connection ? "Trocar conexão" : "Conectar Notion"}</Button>{status.connection && <Button variant="subtle" color="red" disabled={busy} onClick={() => setDisconnectOpen(true)}>Desconectar</Button>}</Group>}</Group>
      {!status.configured && <Alert color="orange">A chave de criptografia das integrações precisa ser configurada pelo administrador.</Alert>}
      {(!status.connection || connectionDetails) && <>
      <Text size="sm">No Notion, abra a página ou base, clique em ••• → Conexões e adicione sua integração. Apenas o conteúdo autorizado será consultado.</Text>
      <Text size="xs" c="dimmed">Consulta somente de leitura. O conteúdo compartilhado fica disponível aos perfis com acesso ao módulo Notion no Hub.</Text>
      </>}
      {!status.canManage && !status.connection && <Alert color="blue">Peça a um gestor para conectar o Notion.</Alert>}
    </Stack></Paper>}
    {status?.connection && <NotionBrowser key={status.connection.checkedAt} storageKey={`fortuno-notion-base:${status.organizationId || status.connection.workspaceName}`} />}
    <Modal opened={connectOpen} onClose={() => { if (!busy) { setConnectOpen(false); setToken(""); } }} title="Conectar Notion" centered><Stack><Text size="sm">Cole o token da integração interna. Ele será enviado ao servidor do Hub, validado no Notion e armazenado criptografado. Não será exibido novamente.</Text><PasswordInput label="Token da integração" autoComplete="new-password" value={token} onChange={(event) => setToken(event.currentTarget.value)} disabled={busy} /><Alert color="blue">Os perfis autorizados neste módulo poderão consultar o conteúdo compartilhado com esta integração.</Alert><Button loading={busy} disabled={token.trim().length < 20} onClick={() => void connect()}>Validar e conectar</Button></Stack></Modal>
    <Modal opened={disconnectOpen} onClose={() => !busy && setDisconnectOpen(false)} title="Desconectar Notion" centered><Stack><Text size="sm">A credencial será removida do Hub. As páginas e bases do Notion serão preservadas.</Text><Button color="red" loading={busy} onClick={() => void disconnect()}>Desconectar integração</Button></Stack></Modal>
  </div>;
}
