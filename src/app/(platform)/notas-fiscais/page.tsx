/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  FileButton,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconAlertTriangle,
  IconBuildingBank,
  IconCheck,
  IconCloudUpload,
  IconFileInvoice,
  IconLink,
  IconRefresh,
  IconSend,
  IconUnlink,
} from "@tabler/icons-react";
import styles from "./notas-fiscais.module.css";

type Option = { value: string; label: string; document?: string | null };
type Permission = { canView: boolean; canEdit: boolean; canImport: boolean; canExport: boolean; canManage: boolean };
type InvoiceItem = {
  id: string;
  lineNumber: number;
  productCode: string | null;
  description: string;
  ncm: string | null;
  cfop: string | null;
  unit: string | null;
  quantity: number;
  unitValue: number;
  totalValue: number;
  allocationAmount: number;
  contaAzulCategoryId: string | null;
  contaAzulCategoryName: string | null;
  contaAzulCostCenterId: string | null;
  contaAzulCostCenterName: string | null;
  learned: boolean;
};
type Invoice = {
  id: string;
  number: string;
  series: string | null;
  accessKey: string | null;
  supplierName: string;
  supplierDocument: string | null;
  supplierContaAzulId: string | null;
  supplierContaAzulName: string | null;
  issueDate: string;
  competenceDate: string;
  dueDate: string;
  totalProducts: number;
  totalInvoice: number;
  financialAccountId: string | null;
  financialAccountName: string | null;
  paymentMethod: string;
  status: "PENDING_REVIEW" | "READY_TO_SEND" | "SENT" | "FAILED" | "IGNORED";
  externalPayableProtocolId: string | null;
  lastError: string | null;
  items: InvoiceItem[];
};
type Bootstrap = {
  configured: boolean;
  connection: null | { status: string; active: boolean; externalTenantName: string | null; lastSyncAt: string | null; lastError: string | null };
  permission: Permission;
  limitations: { message: string };
  invoices: Invoice[];
};

const paymentMethods = [
  { value: "BOLETO_BANCARIO", label: "Boleto bancário" },
  { value: "PIX_PAGAMENTO_INSTANTANEO", label: "Pix" },
  { value: "TRANSFERENCIA_BANCARIA", label: "Transferência bancária" },
  { value: "DINHEIRO", label: "Dinheiro" },
  { value: "OUTRO", label: "Outro" },
];

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function dateInput(value: string) {
  return value ? new Date(value).toISOString().slice(0, 10) : "";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(value));
}

function statusInfo(status: Invoice["status"]) {
  if (status === "READY_TO_SEND") return { color: "blue", label: "Pronta para enviar" };
  if (status === "SENT") return { color: "green", label: "Despesa enviada" };
  if (status === "FAILED") return { color: "red", label: "Falha no envio" };
  if (status === "IGNORED") return { color: "gray", label: "Ignorada" };
  return { color: "orange", label: "Revisão pendente" };
}

export default function NotasFiscaisPage() {
  const [clients, setClients] = useState<Option[]>([]);
  const [clientId, setClientId] = useState<string | null>(null);
  const [data, setData] = useState<Bootstrap | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Option[]>([]);
  const [costCenters, setCostCenters] = useState<Option[]>([]);
  const [financialAccounts, setFinancialAccounts] = useState<Option[]>([]);
  const [suppliers, setSuppliers] = useState<Option[]>([]);

  const selected = data?.invoices.find((invoice) => invoice.id === selectedId) || null;
  const connected = Boolean(data?.connection?.active && data.connection.status === "CONNECTED");

  useEffect(() => {
    fetch("/api/clients?page=1&pageSize=100&status=active", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Não foi possível carregar os clientes.");
        const options = (body.data || []).map((client: { id: string; name: string }) => ({ value: client.id, label: client.name }));
        setClients(options);
        const fromUrl = new URLSearchParams(window.location.search).get("clientId");
        setClientId(fromUrl && options.some((item: Option) => item.value === fromUrl) ? fromUrl : options[0]?.value || null);
        const params = new URLSearchParams(window.location.search);
        if (params.get("ca") === "connected") notifications.show({ color: "green", title: "Conta Azul", message: "Cliente conectado com sucesso." });
        if (params.get("ca_error")) notifications.show({ color: "red", title: "Conta Azul", message: "Não foi possível concluir a conexão. Confira as credenciais e tente novamente." });
      })
      .catch((error) => notifications.show({ color: "red", title: "Clientes", message: error.message }));
  }, []);

  const load = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/purchase-invoices/bootstrap?clientId=${encodeURIComponent(clientId)}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível carregar as notas.");
      setData(body);
      setSelectedId((current) => current && body.invoices.some((invoice: Invoice) => invoice.id === current) ? current : body.invoices[0]?.id || null);
    } catch (error) {
      notifications.show({ color: "red", title: "Notas fiscais", message: error instanceof Error ? error.message : "Falha ao carregar." });
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!clientId || !connected) {
      setCategories([]); setCostCenters([]); setFinancialAccounts([]); setSuppliers([]);
      return;
    }
    const supplier = selected?.supplierDocument || "";
    fetch(`/api/integrations/conta-azul/options?clientId=${encodeURIComponent(clientId)}&supplier=${encodeURIComponent(supplier)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Não foi possível carregar os cadastros da Conta Azul.");
        setCategories(body.categories || []);
        setCostCenters(body.costCenters || []);
        setFinancialAccounts(body.financialAccounts || []);
        setSuppliers(body.suppliers || []);
      })
      .catch((error) => notifications.show({ color: "red", title: "Cadastros Conta Azul", message: error.message }));
  }, [clientId, connected, selected?.supplierDocument]);

  const summary = useMemo(() => {
    const invoices = data?.invoices || [];
    return {
      total: invoices.length,
      pending: invoices.filter((invoice) => invoice.status === "PENDING_REVIEW" || invoice.status === "FAILED").length,
      ready: invoices.filter((invoice) => invoice.status === "READY_TO_SEND").length,
      sent: invoices.filter((invoice) => invoice.status === "SENT").length,
    };
  }, [data?.invoices]);

  function patchSelected(updater: (invoice: Invoice) => Invoice) {
    if (!selectedId) return;
    setData((current) => current ? { ...current, invoices: current.invoices.map((invoice) => invoice.id === selectedId ? updater(invoice) : invoice) } : current);
  }

  async function importXml(files: File[]) {
    if (!clientId || !files.length) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.set("clientId", clientId);
      files.forEach((file) => formData.append("files", file));
      const response = await fetch("/api/purchase-invoices/import", { method: "POST", body: formData });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível importar os XMLs.");
      notifications.show({ color: "green", title: "NF-e importada", message: body.message });
      await load();
    } catch (error) {
      notifications.show({ color: "red", title: "Importação", message: error instanceof Error ? error.message : "Falha na importação." });
    } finally {
      setUploading(false);
    }
  }

  async function saveReview() {
    if (!selected) return false;
    setSaving(true);
    try {
      const response = await fetch(`/api/purchase-invoices/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId: selected.supplierContaAzulId,
          supplierName: selected.supplierContaAzulName,
          financialAccountId: selected.financialAccountId,
          financialAccountName: selected.financialAccountName,
          competenceDate: dateInput(selected.competenceDate),
          dueDate: dateInput(selected.dueDate),
          paymentMethod: selected.paymentMethod,
          items: selected.items.map((item) => ({
            id: item.id,
            categoryId: item.contaAzulCategoryId,
            categoryName: item.contaAzulCategoryName,
            costCenterId: item.contaAzulCostCenterId,
            costCenterName: item.contaAzulCostCenterName,
          })),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível salvar a revisão.");
      notifications.show({ color: "green", title: "Revisão", message: body.message });
      await load();
      return true;
    } catch (error) {
      notifications.show({ color: "red", title: "Revisão", message: error instanceof Error ? error.message : "Falha ao salvar." });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function sendExpense() {
    if (!selected) return;
    setSending(true);
    try {
      if (!(await saveReview())) return;
      const response = await fetch(`/api/purchase-invoices/${selected.id}/send`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível gerar a despesa.");
      notifications.show({ color: "green", title: "Despesa gerada", message: `${body.message} Protocolo: ${body.protocolId}` });
      await load();
    } catch (error) {
      notifications.show({ color: "red", title: "Conta Azul", message: error instanceof Error ? error.message : "Falha ao enviar." });
    } finally {
      setSending(false);
    }
  }

  async function disconnect() {
    if (!clientId) return;
    const response = await fetch(`/api/integrations/conta-azul/status?clientId=${encodeURIComponent(clientId)}`, { method: "DELETE" });
    const body = await response.json();
    if (!response.ok) return notifications.show({ color: "red", title: "Conta Azul", message: body.error });
    notifications.show({ color: "green", title: "Conta Azul", message: body.message });
    await load();
  }

  return (
    <main className={styles.page}>
      <div className={styles.header}>
        <div>
          <Text className={styles.eyebrow}>Financeiro</Text>
          <Title order={1}>Notas fiscais de entrada</Title>
          <Text c="dimmed">Revise os itens da NF-e, aprenda a categorização e gere a despesa rateada no Conta Azul.</Text>
        </div>
        <Group>
          <Button variant="default" leftSection={<IconRefresh size={17} />} onClick={() => void load()} loading={loading}>Atualizar</Button>
          <FileButton onChange={(files) => void importXml(files)} accept="application/xml,text/xml,.xml" multiple>
            {(props) => <Button {...props} leftSection={<IconCloudUpload size={18} />} loading={uploading} disabled={!clientId || !data?.permission.canImport}>Importar XML da NF-e</Button>}
          </FileButton>
        </Group>
      </div>

      <Stack gap="md">
        <Paper withBorder radius="lg" p="lg">
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
            <div>
              <Text size="sm" fw={700} mb={6}>Cliente</Text>
              <Select searchable data={clients} value={clientId} onChange={setClientId} placeholder="Selecione o cliente" />
              <Text size="xs" c="dimmed" mt={7}>Cada cliente autoriza sua própria empresa no Conta Azul.</Text>
            </div>
            <div>
              <Group justify="space-between" align="flex-start">
                <div>
                  <Group gap="xs">
                    <IconBuildingBank size={20} />
                    <Text fw={800}>Conta Azul</Text>
                    <Badge color={connected ? "green" : "gray"}>{connected ? "Conectado" : "Não conectado"}</Badge>
                  </Group>
                  <Text size="sm" c="dimmed" mt={7}>{connected ? data?.connection?.externalTenantName || "Autorização OAuth 2.0 ativa" : "Autorize o acesso seguro para consultar cadastros e gerar despesas."}</Text>
                </div>
                <Group gap="xs">
                  {connected && data?.permission.canManage && <Button color="red" variant="light" leftSection={<IconUnlink size={16} />} onClick={() => void disconnect()}>Desconectar</Button>}
                  {!connected && data?.permission.canManage && clientId && <Button component="a" href={`/api/integrations/conta-azul/connect?clientId=${encodeURIComponent(clientId)}`} leftSection={<IconLink size={16} />} disabled={!data?.configured}>Vincular cliente</Button>}
                </Group>
              </Group>
              {data && !data.configured && <Alert color="orange" mt="sm" icon={<IconAlertTriangle size={17} />}>Configure as credenciais da aplicação Conta Azul no ambiente do Fortuno Hub antes de vincular clientes.</Alert>}
            </div>
          </SimpleGrid>
        </Paper>

        <Alert color="yellow" icon={<IconAlertTriangle size={18} />} title="Fluxo seguro enquanto a API de compras não está disponível">
          {data?.limitations.message || "A API pública ainda não entrega as notas de entrada."} No Conta Azul, gere a compra sem gerar o financeiro; depois importe aqui o XML original da NF-e e crie uma única despesa rateada.
        </Alert>

        <div className={styles.summaryGrid}>
          {[{ label: "Notas disponíveis", value: summary.total, color: "#0a1833" }, { label: "Para revisar", value: summary.pending, color: "#e67e22" }, { label: "Prontas", value: summary.ready, color: "#1683e8" }, { label: "Enviadas", value: summary.sent, color: "#2fb65d" }].map((item) => (
            <Card key={item.label} withBorder radius="lg" p="lg"><Text size="sm" c="dimmed">{item.label}</Text><Text className={styles.summaryValue} style={{ color: item.color }}>{item.value}</Text></Card>
          ))}
        </div>

        {loading && !data ? <Paper withBorder radius="lg" p={50}><Group justify="center"><Loader /><Text>Carregando notas fiscais…</Text></Group></Paper> : (
          <div className={styles.workspace}>
            <Paper withBorder radius="lg" p="md">
              <Group justify="space-between" mb="md"><div><Title order={3}>Notas disponíveis</Title><Text size="sm" c="dimmed">Selecione uma nota para revisar.</Text></div><Badge>{data?.invoices.length || 0}</Badge></Group>
              <Stack gap="sm">
                {data?.invoices.map((invoice) => {
                  const info = statusInfo(invoice.status);
                  return <button type="button" key={invoice.id} className={`${styles.invoiceButton} ${selectedId === invoice.id ? styles.invoiceButtonActive : ""}`} onClick={() => setSelectedId(invoice.id)}>
                    <Group justify="space-between" align="flex-start" wrap="nowrap"><div><Text fw={800}>NF-e {invoice.number}</Text><Text size="sm" lineClamp={1}>{invoice.supplierName}</Text><Text size="xs" c="dimmed">{formatDate(invoice.issueDate)} · {invoice.items.length} item(ns)</Text></div><div style={{ textAlign: "right" }}><Text fw={800}>{money(invoice.totalInvoice)}</Text><Badge color={info.color} size="sm">{info.label}</Badge></div></Group>
                  </button>;
                })}
                {!data?.invoices.length && <Stack align="center" py={40}><IconFileInvoice size={42} color="#9aa7ba" /><Text c="dimmed" ta="center">Nenhuma NF-e importada para este cliente.<br />Use “Importar XML da NF-e”.</Text></Stack>}
              </Stack>
            </Paper>

            <Paper withBorder radius="lg" p="lg">
              {!selected ? <Stack align="center" py={70}><IconFileInvoice size={52} color="#9aa7ba" /><Text c="dimmed">Selecione uma nota para abrir a revisão.</Text></Stack> : (
                <Stack gap="lg">
                  <Group justify="space-between" align="flex-start"><div><Group gap="xs"><Title order={2}>NF-e {selected.number}</Title><Badge color={statusInfo(selected.status).color}>{statusInfo(selected.status).label}</Badge></Group><Text c="dimmed">{selected.supplierName}{selected.supplierDocument ? ` · ${selected.supplierDocument}` : ""}</Text></div><div style={{ textAlign: "right" }}><Text size="sm" c="dimmed">Total da nota</Text><Title order={2}>{money(selected.totalInvoice)}</Title></div></Group>
                  {selected.lastError && <Alert color="red" title="Último envio não foi concluído">{selected.lastError}</Alert>}
                  <SimpleGrid cols={{ base: 1, md: 2 }}>
                    <Select label="Fornecedor no Conta Azul" searchable data={suppliers} value={selected.supplierContaAzulId} placeholder={connected ? "Selecione o fornecedor" : "Conecte a Conta Azul"} disabled={!connected || selected.status === "SENT"} onChange={(value) => patchSelected((invoice) => ({ ...invoice, supplierContaAzulId: value, supplierContaAzulName: suppliers.find((item) => item.value === value)?.label || null }))} />
                    <Select label="Conta financeira" searchable data={financialAccounts} value={selected.financialAccountId} placeholder={connected ? "Selecione a conta" : "Conecte a Conta Azul"} disabled={!connected || selected.status === "SENT"} onChange={(value) => patchSelected((invoice) => ({ ...invoice, financialAccountId: value, financialAccountName: financialAccounts.find((item) => item.value === value)?.label || null }))} />
                    <Select label="Forma de pagamento" data={paymentMethods} value={selected.paymentMethod} disabled={selected.status === "SENT"} onChange={(value) => patchSelected((invoice) => ({ ...invoice, paymentMethod: value || "OUTRO" }))} />
                    <div><Text size="sm" fw={600} mb={6}>Datas</Text><Group gap="xs"><input aria-label="Competência" type="date" value={dateInput(selected.competenceDate)} disabled={selected.status === "SENT"} onChange={(event) => patchSelected((invoice) => ({ ...invoice, competenceDate: `${event.target.value}T12:00:00.000Z` }))} /><input aria-label="Vencimento" type="date" value={dateInput(selected.dueDate)} disabled={selected.status === "SENT"} onChange={(event) => patchSelected((invoice) => ({ ...invoice, dueDate: `${event.target.value}T12:00:00.000Z` }))} /></Group></div>
                  </SimpleGrid>
                  <ScrollArea>
                    <Table striped highlightOnHover className={styles.itemTable} miw={900}>
                      <Table.Thead><Table.Tr><Table.Th>Item da nota</Table.Th><Table.Th>Qtd.</Table.Th><Table.Th>Valor NF-e</Table.Th><Table.Th>Valor no rateio</Table.Th><Table.Th>Categoria Conta Azul</Table.Th><Table.Th>Centro de custo</Table.Th></Table.Tr></Table.Thead>
                      <Table.Tbody>{selected.items.map((item) => <Table.Tr key={item.id}>
                        <Table.Td><Text fw={700} size="sm">{item.description}</Text><Text size="xs" c="dimmed">Cód. {item.productCode || "-"} · NCM {item.ncm || "-"} · CFOP {item.cfop || "-"}</Text>{item.learned && <Badge mt={5} size="xs" color="green">Aprendida</Badge>}</Table.Td>
                        <Table.Td>{item.quantity} {item.unit}</Table.Td><Table.Td>{money(item.totalValue)}</Table.Td><Table.Td fw={700}>{money(item.allocationAmount)}</Table.Td>
                        <Table.Td><Select searchable data={categories} value={item.contaAzulCategoryId} placeholder="Selecione" disabled={!connected || selected.status === "SENT"} onChange={(value) => patchSelected((invoice) => ({ ...invoice, items: invoice.items.map((current) => current.id === item.id ? { ...current, contaAzulCategoryId: value, contaAzulCategoryName: categories.find((option) => option.value === value)?.label || null, learned: false } : current) }))} /></Table.Td>
                        <Table.Td><Select searchable clearable data={costCenters} value={item.contaAzulCostCenterId} placeholder="Opcional" disabled={!connected || selected.status === "SENT"} onChange={(value) => patchSelected((invoice) => ({ ...invoice, items: invoice.items.map((current) => current.id === item.id ? { ...current, contaAzulCostCenterId: value, contaAzulCostCenterName: costCenters.find((option) => option.value === value)?.label || null, learned: false } : current) }))} /></Table.Td>
                      </Table.Tr>)}</Table.Tbody>
                    </Table>
                  </ScrollArea>
                  <Group justify="space-between"><Text size="sm" c="dimmed">O valor da nota é distribuído proporcionalmente entre os itens para que o rateio feche exatamente, inclusive quando há frete, impostos ou descontos.</Text><Group><Button variant="default" onClick={() => void saveReview()} loading={saving} disabled={selected.status === "SENT" || !data?.permission.canEdit}>Salvar revisão</Button><Button color="green" leftSection={selected.status === "SENT" ? <IconCheck size={17} /> : <IconSend size={17} />} onClick={() => void sendExpense()} loading={sending} disabled={selected.status === "SENT" || !connected || !data?.permission.canExport}>{selected.status === "SENT" ? "Despesa enviada" : "Gerar despesa no Conta Azul"}</Button></Group></Group>
                </Stack>
              )}
            </Paper>
          </div>
        )}
      </Stack>
    </main>
  );
}
