/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { INVOICE_SEND_PENDING, requiresInvoiceVerification } from "@/modules/purchase-invoices/send-state";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  FileButton,
  Group,
  Loader,
  NumberInput,
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
  IconCalendar,
  IconCheck,
  IconCloudUpload,
  IconFileInvoice,
  IconLink,
  IconPlus,
  IconReceipt,
  IconRefresh,
  IconSend,
  IconTrash,
  IconUnlink,
} from "@tabler/icons-react";
import { beginSessionKeepAlive } from "@/modules/session/client-activity";
import styles from "./notas-fiscais.module.css";

type Option = { value: string; label: string; document?: string | null };
type Permission = { canView: boolean; canEdit: boolean; canDelete: boolean; canImport: boolean; canExport: boolean; canManage: boolean };
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
type InvoiceInstallment = {
  id?: string;
  installmentNumber: number;
  externalNumber: string | null;
  dueDate: string;
  amount: number;
  source: "XML" | "MANUAL_REQUIRED" | "MANUAL";
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
  installments: InvoiceInstallment[];
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

function installmentSourceInfo(source: InvoiceInstallment["source"]) {
  if (source === "XML") return { color: "green", label: "Lida da NF-e" };
  if (source === "MANUAL") return { color: "blue", label: "Revisada" };
  return { color: "orange", label: "Confirmar data" };
}

function roundedMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export default function NotasFiscaisPage() {
  const [clients, setClients] = useState<Option[]>([]);
  const [clientId, setClientId] = useState<string | null>(null);
  const [data, setData] = useState<Bootstrap | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
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
      notifications.show({ color: "red", title: "Notas de compra", message: error instanceof Error ? error.message : "Falha ao carregar." });
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

  function updateInstallment(index: number, changes: Partial<InvoiceInstallment>) {
    patchSelected((invoice) => ({
      ...invoice,
      installments: invoice.installments.map((installment, currentIndex) => currentIndex === index
        ? { ...installment, ...changes }
        : installment),
    }));
  }

  function addInstallment() {
    patchSelected((invoice) => {
      const currentTotal = roundedMoney(invoice.installments.reduce((sum, installment) => sum + Number(installment.amount || 0), 0));
      const remaining = roundedMoney(Math.max(invoice.totalInvoice - currentTotal, 0));
      const lastDueDate = invoice.installments.at(-1)?.dueDate || invoice.issueDate;
      return {
        ...invoice,
        installments: [...invoice.installments, {
          installmentNumber: invoice.installments.length + 1,
          externalNumber: null,
          dueDate: lastDueDate,
          amount: remaining,
          source: "MANUAL",
        }],
      };
    });
  }

  function removeInstallment(index: number) {
    patchSelected((invoice) => ({
      ...invoice,
      installments: invoice.installments
        .filter((_, currentIndex) => currentIndex !== index)
        .map((installment, currentIndex) => ({ ...installment, installmentNumber: currentIndex + 1 })),
    }));
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
          paymentMethod: selected.paymentMethod,
          installments: selected.installments.map((installment) => ({
            externalNumber: installment.externalNumber,
            dueDate: dateInput(installment.dueDate),
            amount: installment.amount,
            source: installment.source,
          })),
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
    const invoice = selected;
    const notificationId = `purchase-invoice-send-${invoice.id}`;
    const releaseSessionKeepAlive = beginSessionKeepAlive();
    setSending(true);
    try {
      if (!(await saveReview())) return;
      notifications.hide(notificationId);
      notifications.show({
        id: notificationId,
        loading: true,
        autoClose: false,
        withCloseButton: false,
        color: "blue",
        title: "Envio ao Conta Azul em andamento",
        message: `A NF-e ${invoice.number} está sendo processada. Você pode continuar usando o sistema.`,
      });
      const response = await fetch(`/api/purchase-invoices/${invoice.id}/send`, {
        method: "POST",
        keepalive: true,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível gerar a despesa.");
      notifications.update({
        id: notificationId,
        loading: false,
        autoClose: 6000,
        withCloseButton: true,
        color: "green",
        title: "Despesa gerada",
        message: `${body.message}${body.eventId ? ` ID da despesa: ${body.eventId}` : body.protocolId ? ` Protocolo: ${body.protocolId}` : ""}`,
      });
      await load();
    } catch (error) {
      notifications.update({
        id: notificationId,
        loading: false,
        autoClose: 10000,
        withCloseButton: true,
        color: "red",
        title: "Envio não concluído",
        message: error instanceof Error ? error.message : "Falha ao enviar.",
      });
      await load();
    } finally {
      releaseSessionKeepAlive();
      setSending(false);
    }
  }

  async function deleteInvoice(invoice: Invoice) {
    if (invoice.status === "SENT" || invoice.externalPayableProtocolId) {
      notifications.show({
        color: "orange",
        title: "Nota já enviada",
        message: "A despesa desta nota já foi criada no Conta Azul e não pode ser excluída por aqui.",
      });
      return;
    }
    const confirmed = window.confirm(
      `Excluir a NF-e ${invoice.number} de ${invoice.supplierName}? O XML, os itens e as parcelas importadas serão removidos do Fortuno Hub.`,
    );
    if (!confirmed) return;

    setDeletingId(invoice.id);
    try {
      const response = await fetch(`/api/purchase-invoices/${invoice.id}`, {
        method: "DELETE",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível excluir a nota.");
      setSelectedId((current) => current === invoice.id ? null : current);
      notifications.show({ color: "green", title: "Nota excluída", message: body.message });
      await load();
    } catch (error) {
      notifications.show({
        color: "red",
        title: "Exclusão não concluída",
        message: error instanceof Error ? error.message : "Não foi possível excluir a nota.",
      });
    } finally {
      setDeletingId(null);
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

  const selectedInstallmentTotal = roundedMoney(selected?.installments.reduce(
    (sum, installment) => sum + Number(installment.amount || 0),
    0,
  ) || 0);
  const selectedInstallmentDifference = roundedMoney((selected?.totalInvoice || 0) - selectedInstallmentTotal);

  return (
    <main className={styles.page}>
      <div className={styles.header}>
        <div>
          <Text className={styles.eyebrow}>Financeiro</Text>
          <Title order={1}>Notas de compra</Title>
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
                  <Button
                    component="a"
                    href="/integracoes/conta-azul"
                    variant="default"
                    leftSection={<IconLink size={16} />}
                  >
                    Gerenciar vínculos
                  </Button>
                  {connected && data?.permission.canManage && <Button color="red" variant="light" leftSection={<IconUnlink size={16} />} onClick={() => void disconnect()}>Desconectar</Button>}
                  {!connected && data?.permission.canManage && clientId && <Button component="a" href={`/api/integrations/conta-azul/connect?clientId=${encodeURIComponent(clientId)}`} leftSection={<IconLink size={16} />} disabled={!data?.configured}>Vincular cliente</Button>}
                </Group>
              </Group>
              {data && !data.configured && <Alert color="orange" mt="sm" icon={<IconAlertTriangle size={17} />}>Configure as credenciais da aplicação Conta Azul no ambiente do Fortuno Hub antes de vincular clientes.</Alert>}
            </div>
          </SimpleGrid>
        </Paper>

        <Alert color="yellow" icon={<IconAlertTriangle size={18} />} title="Fluxo seguro enquanto a API de compras não está disponível">
          {data?.limitations.message || "A API pública ainda não entrega as notas de entrada."} No Conta Azul, gere a compra sem gerar o financeiro; depois importe aqui o XML original da NF-e e crie a despesa rateada com todos os vencimentos.
        </Alert>

        <div className={styles.summaryGrid}>
          {[{ label: "Notas disponíveis", value: summary.total, color: "#0a1833" }, { label: "Para revisar", value: summary.pending, color: "#e67e22" }, { label: "Prontas", value: summary.ready, color: "#1683e8" }, { label: "Enviadas", value: summary.sent, color: "#2fb65d" }].map((item) => (
            <Card key={item.label} withBorder radius="lg" p="lg"><Text size="sm" c="dimmed">{item.label}</Text><Text className={styles.summaryValue} style={{ color: item.color }}>{item.value}</Text></Card>
          ))}
        </div>

        {loading && !data ? <Paper withBorder radius="lg" p={50}><Group justify="center"><Loader /><Text>Carregando notas de compra…</Text></Group></Paper> : (
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
                  <div className={styles.invoiceHeader}>
                    <Group justify="space-between" align="flex-start" gap="lg">
                      <div>
                        <Group gap="xs">
                          <IconReceipt size={24} />
                          <Title order={2}>NF-e {selected.number}</Title>
                          <Badge color={statusInfo(selected.status).color}>{statusInfo(selected.status).label}</Badge>
                        </Group>
                        <Text c="dimmed" mt={4}>{selected.supplierName}{selected.supplierDocument ? ` · ${selected.supplierDocument}` : ""}</Text>
                      </div>
                      <Group align="flex-start" gap="md">
                        <div className={styles.invoiceTotal}>
                          <Text size="sm" c="dimmed">Total da nota</Text>
                          <Title order={2}>{money(selected.totalInvoice)}</Title>
                        </div>
                        {data?.permission.canDelete && (
                          <Button
                            color="red"
                            variant="light"
                            leftSection={<IconTrash size={16} />}
                            loading={deletingId === selected.id}
                            disabled={sending || requiresInvoiceVerification(selected.lastError) || selected.status === "SENT" || Boolean(selected.externalPayableProtocolId)}
                            title={sending
                              ? "Aguarde o envio desta nota terminar."
                              : selected.status === "SENT" || selected.externalPayableProtocolId
                                ? "A nota já foi enviada ao Conta Azul."
                                : "Excluir o XML importado e esta nota."}
                            onClick={() => void deleteInvoice(selected)}
                          >
                            Excluir nota
                          </Button>
                        )}
                      </Group>
                    </Group>
                    <div className={styles.invoiceMeta}>
                      <div>
                        <Text size="xs" c="dimmed">Emissão da NF-e</Text>
                        <Text fw={800}>{formatDate(selected.issueDate)}</Text>
                      </div>
                      <div>
                        <Text size="xs" c="dimmed">Entrada / competência</Text>
                        <Group gap={5}><Text fw={800}>{formatDate(selected.issueDate)}</Text><Badge size="xs" color="blue" variant="light">Automática</Badge></Group>
                      </div>
                      <div>
                        <Text size="xs" c="dimmed">Parcelamento</Text>
                        <Text fw={800}>{selected.installments.length === 1 ? "À vista / 1 parcela" : `${selected.installments.length} parcelas`}</Text>
                      </div>
                      <div>
                        <Text size="xs" c="dimmed">Itens identificados</Text>
                        <Text fw={800}>{selected.items.length}</Text>
                      </div>
                    </div>
                  </div>
                  {selected.lastError && <Alert color={requiresInvoiceVerification(selected.lastError) ? "orange" : "red"} title={requiresInvoiceVerification(selected.lastError) ? "Confira a despesa no Conta Azul antes de reenviar" : "Último envio não foi concluído"}>{requiresInvoiceVerification(selected.lastError) ? INVOICE_SEND_PENDING : selected.lastError}</Alert>}
                  <div>
                    <Title order={3}>Dados para o lançamento</Title>
                  </div>
                  <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
                    <Select label="Fornecedor no Conta Azul" searchable data={suppliers} value={selected.supplierContaAzulId} placeholder={connected ? "Selecione o fornecedor" : "Conecte a Conta Azul"} disabled={!connected || selected.status === "SENT"} onChange={(value) => patchSelected((invoice) => ({ ...invoice, supplierContaAzulId: value, supplierContaAzulName: suppliers.find((item) => item.value === value)?.label || null }))} />
                    <Select label="Conta financeira" searchable data={financialAccounts} value={selected.financialAccountId} placeholder={connected ? "Selecione a conta" : "Conecte a Conta Azul"} disabled={!connected || selected.status === "SENT"} onChange={(value) => patchSelected((invoice) => ({ ...invoice, financialAccountId: value, financialAccountName: financialAccounts.find((item) => item.value === value)?.label || null }))} />
                    <Select label="Forma de pagamento" data={paymentMethods} value={selected.paymentMethod} disabled={selected.status === "SENT"} onChange={(value) => patchSelected((invoice) => ({ ...invoice, paymentMethod: value || "OUTRO" }))} />
                  </SimpleGrid>
                  <Divider />
                  <div>
                    <Group justify="space-between" align="flex-start" gap="md">
                      <div>
                        <Group gap="xs"><IconCalendar size={21} /><Title order={3}>Pagamento e parcelas</Title></Group>
                        <Text size="sm" c="dimmed">Confira os vencimentos previstos na NF-e. Cada parcela gerará um título a pagar no Conta Azul.</Text>
                      </div>
                      <Button variant="light" leftSection={<IconPlus size={16} />} onClick={addInstallment} disabled={selected.status === "SENT"}>Adicionar parcela</Button>
                    </Group>
                    <Stack gap="sm" mt="md">
                      {selected.installments.map((installment, index) => {
                        const sourceInfo = installmentSourceInfo(installment.source);
                        return (
                          <div className={styles.installmentCard} key={installment.id || `${index}-${installment.dueDate}`}>
                            <Group justify="space-between" align="center" mb="sm">
                              <Group gap="xs">
                                <Text fw={800}>Parcela {index + 1}/{selected.installments.length}</Text>
                                {installment.externalNumber && <Badge variant="outline" color="gray">Nº {installment.externalNumber}</Badge>}
                                <Badge color={sourceInfo.color} variant="light">{sourceInfo.label}</Badge>
                              </Group>
                              <Group gap="xs">
                                {installment.source === "MANUAL_REQUIRED" && (
                                  <Button size="compact-sm" variant="light" color="orange" onClick={() => updateInstallment(index, { source: "MANUAL" })} disabled={selected.status === "SENT"}>Confirmar</Button>
                                )}
                                <ActionIcon color="red" variant="subtle" aria-label={`Excluir parcela ${index + 1}`} onClick={() => removeInstallment(index)} disabled={selected.status === "SENT" || selected.installments.length === 1}>
                                  <IconTrash size={17} />
                                </ActionIcon>
                              </Group>
                            </Group>
                            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                              <div>
                                <Text size="sm" fw={600} mb={6}>Vencimento / pagamento previsto</Text>
                                <input
                                  className={styles.dateInput}
                                  aria-label={`Vencimento da parcela ${index + 1}`}
                                  type="date"
                                  value={dateInput(installment.dueDate)}
                                  disabled={selected.status === "SENT"}
                                  onChange={(event) => updateInstallment(index, { dueDate: `${event.target.value}T12:00:00.000Z`, source: "MANUAL" })}
                                />
                              </div>
                              <NumberInput
                                label="Valor da parcela"
                                value={installment.amount}
                                min={0}
                                decimalScale={2}
                                fixedDecimalScale
                                decimalSeparator=","
                                thousandSeparator="."
                                prefix="R$ "
                                disabled={selected.status === "SENT"}
                                onChange={(value) => updateInstallment(index, { amount: typeof value === "number" ? value : 0, source: "MANUAL" })}
                              />
                            </SimpleGrid>
                          </div>
                        );
                      })}
                    </Stack>
                    <Group justify="flex-end" mt="sm" gap="xl">
                      <div className={styles.paymentSummary}><Text size="xs" c="dimmed">Soma das parcelas</Text><Text fw={800}>{money(selectedInstallmentTotal)}</Text></div>
                      <div className={styles.paymentSummary}><Text size="xs" c="dimmed">Diferença</Text><Text fw={800} c={Math.abs(selectedInstallmentDifference) <= 0.01 ? "green" : "red"}>{money(selectedInstallmentDifference)}</Text></div>
                    </Group>
                    {Math.abs(selectedInstallmentDifference) > 0.01 && <Alert color="orange" mt="sm" icon={<IconAlertTriangle size={17} />}>A soma das parcelas precisa fechar com o total da nota antes do envio.</Alert>}
                  </div>
                  <Divider />
                  <div>
                    <Title order={3}>Itens e classificação</Title>
                    <Text size="sm" c="dimmed">Revise as categorias e os centros de custo que compõem o rateio da despesa.</Text>
                  </div>
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
                  <Group justify="space-between" align="flex-end">
                    <Text size="sm" c="dimmed" maw={650}>O valor da nota é distribuído proporcionalmente entre os itens para que o rateio feche exatamente, inclusive quando há frete, impostos ou descontos.</Text>
                    <Group>
                      <Button variant="default" onClick={() => void saveReview()} loading={saving} disabled={requiresInvoiceVerification(selected.lastError) || selected.status === "SENT" || !data?.permission.canEdit}>Salvar revisão</Button>
                      <Button
                        color="green"
                        leftSection={selected.status === "SENT" ? <IconCheck size={17} /> : <IconSend size={17} />}
                        onClick={() => void sendExpense()}
                        loading={sending}
                        disabled={
                          selected.status === "SENT"
                          || requiresInvoiceVerification(selected.lastError)
                          || !connected
                          || !data?.permission.canExport
                          || Math.abs(selectedInstallmentDifference) > 0.01
                          || selected.installments.some((installment) => installment.source === "MANUAL_REQUIRED")
                        }
                      >
                        {selected.status === "SENT"
                          ? "Despesa enviada"
                          : sending
                            ? "Enviando em segundo plano..."
                            : requiresInvoiceVerification(selected.lastError) ? "Conferir despesa no Conta Azul" : `Gerar ${selected.installments.length} título(s) no Conta Azul`}
                      </Button>
                    </Group>
                  </Group>
                </Stack>
              )}
            </Paper>
          </div>
        )}
      </Stack>
    </main>
  );
}
