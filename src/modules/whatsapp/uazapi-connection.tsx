"use client";
import { Alert, Badge, Button, Group, Image, Paper, PasswordInput, Stack, Text, TextInput, Title } from "@mantine/core";
import { useCallback, useEffect, useState } from "react";
type Connection = { configured: boolean; status: string; serverUrl?: string; instanceName?: string; phone?: string; profileName?: string; isTestServer?: boolean; expiresAt?: string; webhookReady?: boolean; lastWebhookAt?: string; lastError?: string };
const labels: Record<string, string> = { NOT_CONFIGURED: "Não configurado", DISCONNECTED: "Desconectado", CONNECTING: "Aguardando pareamento", CONNECTED: "Conectado", PAUSED: "Pausado", UNAVAILABLE: "Indisponível", EXPIRED: "Teste expirado" };
export function UazapiConnection({ onStatus }: { onStatus: (status: string) => void }) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [canConfigure, setCanConfigure] = useState(false);
  const [base, setBase] = useState("https://free.uazapi.com"), [token, setToken] = useState(""), [phone, setPhone] = useState("");
  const [qr, setQr] = useState<string | null>(null), [pairCode, setPairCode] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [confirm, setConfirm] = useState(false);
  const receive = useCallback((data: { connection: Connection; qrCode?: string; pairCode?: string; canConfigure?: boolean }) => {
    setConnection(data.connection);
    if (data.canConfigure !== undefined) setCanConfigure(data.canConfigure);
    if (data.connection.serverUrl) setBase(data.connection.serverUrl);
    setQr(data.qrCode || null); setPairCode(data.pairCode || "");
    onStatus(data.connection.status === "CONNECTED" && data.connection.webhookReady ? "CONNECTED" : data.connection.status === "CONNECTED" ? "DISCONNECTED" : data.connection.status);
  }, [onStatus]);
  const refresh = useCallback(async () => {
    try { const response = await fetch("/api/whatsapp/connection", { cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Não foi possível consultar a conexão."); receive(data); } catch (err) { setError(err instanceof Error ? err.message : "Falha ao consultar conexão."); }
  }, [receive]);
  useEffect(() => { const initial = setTimeout(() => { void refresh(); }, 0); const timer = setInterval(() => { void refresh(); }, 10000); return () => { clearTimeout(initial); clearInterval(timer); }; }, [refresh]);
  async function action(input: Record<string, unknown>) {
    setBusy(true); setError("");
    try { const response = await fetch("/api/whatsapp/connection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Não foi possível concluir."); receive(data); if (input.action === "SAVE") setToken(""); setConfirm(false); await refresh(); } catch (err) { setError(err instanceof Error ? err.message : "Falha na conexão."); } finally { setBusy(false); }
  }
  return <Stack gap="md">
    <Paper withBorder p="lg" radius="md"><Group justify="space-between"><div><Title order={3}>Conexão Uazapi</Title><Text c="dimmed" size="sm">{connection?.instanceName || "WhatsApp da equipe"}</Text></div><Badge color={connection?.status === "CONNECTED" ? "green" : "gray"}>{labels[connection?.status || "NOT_CONFIGURED"] || connection?.status}</Badge></Group>
      {connection?.phone && <Text mt="sm">{connection.profileName} · +{connection.phone}</Text>}
      {connection?.configured && <Text size="sm" c="dimmed" mt="xs">Recebimento de mensagens: {connection.webhookReady ? "configurado" : "pendente"}{connection.lastWebhookAt ? ` · Último evento: ${new Date(connection.lastWebhookAt).toLocaleString("pt-BR")}` : ""}</Text>}
    </Paper>
    {error && <Alert color="red" title="Não foi possível concluir">{error}</Alert>}
    {connection?.lastError && <Alert color="orange">{connection.lastError}</Alert>}
    {(connection?.isTestServer || base === "https://free.uazapi.com") && <Alert color="orange" title="Servidor gratuito · teste de uma hora">A Uazapi exclui a instância após uma hora. {connection?.expiresAt ? `Validade estimada: ${new Date(connection.expiresAt).toLocaleString("pt-BR")}.` : "O prazo começa na criação da instância."}</Alert>}
    {canConfigure ? <>
      <Paper withBorder p="lg" radius="md"><Stack><Title order={4}>Credenciais da instância</Title><TextInput label="URL do servidor Uazapi" value={base} onChange={(e) => setBase(e.currentTarget.value)} /><PasswordInput label="Token da instância" description="Use o token da instância, disponível no painel Uazapi." value={token} onChange={(e) => setToken(e.currentTarget.value)} autoComplete="off" /><Group><Button loading={busy} disabled={!token.trim()} onClick={() => action({ action: "SAVE", serverUrl: base.trim(), token: token.trim() })}>Validar e salvar conexão</Button><Button variant="default" onClick={() => refresh()}>Atualizar status</Button></Group></Stack></Paper>
      {connection?.configured && <Paper withBorder p="lg" radius="md"><Stack><Title order={4}>Vincular WhatsApp</Title>
        {connection.status !== "CONNECTED" && <><Group><Button loading={busy} onClick={() => action({ action: "CONNECT" })}>Gerar QR Code</Button><Button variant="light" loading={busy} onClick={() => action({ action: "WEBHOOK" })}>Configurar recebimento</Button></Group>
          {qr && <><Image src={qr} alt="QR Code de conexão do WhatsApp" w={280} h={280} fit="contain" /><Text size="sm">No celular: WhatsApp → Aparelhos conectados → Conectar um aparelho. Leia o QR Code.</Text></>}
          <Group align="end"><TextInput label="Ou vincular pelo número" placeholder="55 + DDD + número" value={phone} onChange={(e) => setPhone(e.currentTarget.value.replace(/\D/g, ""))} /><Button variant="default" loading={busy} disabled={!/^\d{10,15}$/.test(phone)} onClick={() => action({ action: "CONNECT", phone })}>Gerar código</Button></Group>{pairCode && <Text fw={700} size="xl">Código: {pairCode}</Text>}
        </>}
        {connection.status === "CONNECTED" && <Group><Button color="red" variant="light" onClick={() => setConfirm(true)}>Desconectar WhatsApp</Button><Button variant="default" loading={busy} onClick={() => action({ action: "WEBHOOK" })}>Verificar recebimento</Button></Group>}
        {confirm && <Alert color="orange" title="Desconectar este WhatsApp?"><Text size="sm" mb="sm">O recebimento e o envio serão interrompidos. Para voltar, será necessário vincular o aparelho novamente.</Text><Group><Button color="red" loading={busy} onClick={() => action({ action: "DISCONNECT", confirmation: "DESCONECTAR" })}>Confirmar desconexão</Button><Button variant="default" onClick={() => setConfirm(false)}>Cancelar</Button></Group></Alert>}
      </Stack></Paper>}
    </> : <Text size="sm" c="dimmed">A configuração da conexão é feita por um administrador autorizado.</Text>}
  </Stack>;
}
