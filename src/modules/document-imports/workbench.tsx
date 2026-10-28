/* eslint-disable react-hooks/set-state-in-effect */
"use client";
import { useEffect, useState } from "react";
import { Alert, Badge, Button, FileButton, Group, Loader, Modal, NumberInput, Paper, ScrollArea, Select, SimpleGrid, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { IconFileUpload, IconPlayerPlay, IconRefresh } from "@tabler/icons-react";
import { extractPdfTextLines } from "@/modules/bank-statements/pdf-reader.client";
import { parseContract, parseInvestment } from "./parsers";
import { type ImportKind, type Review, type Option, type ContractReview, digits, displayDate, money, monthDate, reviewIssues, schedule } from "./model";
import styles from "./workbench.module.css";
type Company = { id: string; name: string; document: string | null; contaAzulConnection: null | { active: boolean; status: string } };
type Sale = { number: number; saleDate: string; dueDate: string; amountCents: number; description?: string };
type Simulation = { validatedAt: string; errors: string[]; sales: Sale[]; totalCents: number; endDate: string | null };
type Draft = { id: string; fileName: string; version: number; data: Review; status: string; simulation: Simulation | null };
type Options = { categories: Option[]; financialAccounts: Option[]; customers: Option[] };
const emptyOptions: Options = { categories: [], financialAccounts: [], customers: [] };
const paymentOptions = [{ value: "BOLETO_BANCARIO", label: "Boleto bancário" }, { value: "PIX_PAGAMENTO_INSTANTANEO", label: "Pix" }, { value: "TRANSFERENCIA_BANCARIA", label: "Transferência bancária" }, { value: "CARTAO_CREDITO", label: "Cartão de crédito" }, { value: "OUTRO", label: "Outro" }];
async function jsonResponse(response: Response) { const body = await response.json(); if (!response.ok) throw new Error(body.error || "Não foi possível concluir a operação."); return body; }
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Não foi possível concluir a operação.";
export function ImportWorkbench({ kind }: { kind: ImportKind }) {
  const [companies, setCompanies] = useState<Company[]>([]), [clientId, setClientId] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]), [selected, setSelected] = useState<Draft | null>(null), [review, setReview] = useState<Review | null>(null);
  const [options, setOptions] = useState<Options>(emptyOptions), [loading, setLoading] = useState(true), [optionsLoading, setOptionsLoading] = useState(false), [busy, setBusy] = useState(false);
  const [canImport, setCanImport] = useState(false), [canEdit, setCanEdit] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0), [preview, setPreview] = useState(false), [password, setPassword] = useState("");
  const company = companies.find((item) => item.id === clientId);
  const connected = Boolean(company?.contaAzulConnection?.active && company.contaAzulConnection.status === "CONNECTED");
  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/document-imports?kind=${kind}`, { cache: "no-store" }).then(jsonResponse).then((body) => {
      if (active) { setCompanies(body.clients); setCanImport(body.permission.canImport && body.permission.canCreate); setCanEdit(body.permission.canEdit); }
    }).catch((cause) => { if (active) setError(errorMessage(cause)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [kind]);
  useEffect(() => {
    let active = true;
    setDrafts([]); setSelected(null); setReview(null); setOptions(emptyOptions); setError("");
    if (!clientId) return;
    fetch(`/api/document-imports?kind=${kind}&clientId=${encodeURIComponent(clientId)}`, { cache: "no-store" }).then(jsonResponse).then((body) => { if (active) setDrafts(body.drafts); }).catch((cause) => { if (active) setError(errorMessage(cause)); });
    return () => { active = false; };
  }, [clientId, kind]);
  const buyerDocument = review?.kind === "CONTRACT" ? review.buyerDocument : "";
  useEffect(() => {
    let active = true;
    setOptions(emptyOptions); setOptionsLoading(false);
    if (!clientId || !connected) return;
    setOptionsLoading(true);
    const query = new URLSearchParams({ kind, clientId, options: "1", term: buyerDocument });
    fetch(`/api/document-imports?${query}`, { cache: "no-store" }).then(jsonResponse).then((body: Options) => {
      if (!active) return;
      setOptions(body);
      const matches = body.customers.filter((item) => buyerDocument && digits(item.document || "") === digits(buyerDocument));
      if (matches.length === 1) setReview((previous) => previous?.kind === "CONTRACT" ? { ...previous, customerId: previous.customerId || matches[0].value } : previous);
    }).catch((cause) => { if (active) setError(errorMessage(cause)); }).finally(() => { if (active) setOptionsLoading(false); });
    return () => { active = false; };
  }, [clientId, kind, connected, buyerDocument, revision]);
  async function importFiles(files: File[]) {
    if (!clientId || !files.length) return;
    if (files.length > 10) { setError("Importe no máximo 10 PDFs por lote."); return; }
    setBusy(true); setError(""); setNotice("");
    const failures: string[] = []; let imported = 0; let duplicates = 0;
    for (const file of files) {
      try {
        if (file.size > 15 * 1024 * 1024 || !/\.pdf$/i.test(file.name)) throw new Error("Use um PDF de até 15 MB.");
        const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
        const fingerprint = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
        const lines = await extractPdfTextLines(file, password, 100);
        const data = kind === "INVESTMENT" ? parseInvestment(lines) : parseContract(lines);
        const body = await jsonResponse(await fetch("/api/document-imports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, fingerprint, fileName: file.name, data }) }));
        setDrafts((previous) => [body.draft, ...previous.filter((item) => item.id !== body.draft.id)]); setSelected(body.draft); setReview(body.draft.data);
        if (body.duplicate) duplicates++; else imported++;
      } catch (cause) { failures.push(`${file.name}: ${errorMessage(cause)}`); }
    }
    setPassword(""); setBusy(false); setNotice(`${imported} arquivo(s) importado(s)${duplicates ? ` · ${duplicates} já existente(s), revisão preservada` : ""}. Nenhum lançamento enviado ao CA.`);
    if (failures.length) setError(failures.join("\n"));
  }
  async function save(action: "save" | "simulate") {
    if (!selected || !review) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const body = await jsonResponse(await fetch(`/api/document-imports/${selected.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, version: selected.version, data: review }) }));
      setSelected(body.draft); setReview(body.draft.data); setDrafts((previous) => previous.map((draft) => draft.id === selected.id ? body.draft : draft));
      if (action === "simulate") setPreview(true);
      setNotice(action === "save" ? "Revisão salva." : "Simulação concluída. Nenhum lançamento enviado ao CA.");
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  const changeContract = (patch: Partial<ContractReview>) => setReview((previous) => previous?.kind === "CONTRACT" ? { ...previous, ...patch } : previous);
  const issues = review ? reviewIssues(review) : [];
  const planned = review?.kind === "CONTRACT" ? schedule(review) : [];
  const changed = Boolean(review && selected && JSON.stringify(review) !== JSON.stringify(selected.data));
  if (loading) return <Group justify="center" p="xl"><Loader /></Group>;
  return <Stack gap="md" className={styles.page}>
    <Group justify="space-between"><Title order={2}>{kind === "INVESTMENT" ? "Rendimentos de aplicações" : "Importação de contratos"}</Title><Badge color="orange" variant="light">Modo teste · sem envio ao CA</Badge></Group>
    <Paper withBorder radius="md" p="md"><Group align="flex-end">
      <Select className={styles.company} label="Empresa no Fortuno / Conta Azul" placeholder="Selecione a empresa" searchable clearable disabled={busy} value={clientId || null} onChange={(value) => { if (changed && !window.confirm("Descartar as alterações não salvas?")) return; setClientId(value || ""); setNotice(""); }} data={companies.map((item) => ({ value: item.id, label: item.name }))} />
      {clientId && <Badge color={connected ? "green" : "gray"}>{connected ? "CA conectado" : "CA não conectado"}</Badge>}
      <TextInput label="Senha do PDF (se houver)" type="password" value={password} onChange={(event) => setPassword(event.currentTarget.value)} autoComplete="off" w={180} disabled={busy} />
      <FileButton onChange={(files) => { if (changed && !window.confirm("Descartar as alterações não salvas?")) return; void importFiles(files); }} accept="application/pdf" multiple>{(props) => <Button {...props} leftSection={<IconFileUpload size={17} />} disabled={!clientId || !canImport} loading={busy}>Importar PDFs</Button>}</FileButton>
      <Button variant="subtle" leftSection={<IconRefresh size={16} />} disabled={!clientId || optionsLoading || busy} onClick={() => setRevision((value) => value + 1)}>Atualizar CA</Button>
    </Group></Paper>
    {error && <Alert color="red" withCloseButton onClose={() => setError("")} style={{ whiteSpace: "pre-wrap" }}>{error}</Alert>}
    {notice && <Alert color="teal" withCloseButton onClose={() => setNotice("")}>{notice}</Alert>}
    {!clientId ? <Paper withBorder p="xl"><Text c="dimmed">Selecione a empresa para importar e revisar os documentos.</Text></Paper> : <div className={styles.workspace}>
      <Paper withBorder radius="md" p="sm"><Text fw={700} mb="sm">Arquivos <Badge variant="light">{drafts.length}</Badge></Text><Stack gap={7}>
        {!drafts.length && <Text size="sm" c="dimmed">Nenhum arquivo importado.</Text>}
        {drafts.map((draft) => <button key={draft.id} disabled={busy} className={`${styles.draft} ${selected?.id === draft.id ? styles.selected : ""}`} onClick={() => { if (changed && !window.confirm("Descartar as alterações não salvas e abrir outro arquivo?")) return; setSelected(draft); setReview(draft.data); setPreview(false); }}><Text size="sm" fw={600} lineClamp={2}>{draft.fileName}</Text><Badge size="xs" mt={6} color={draft.status === "TESTED" ? "teal" : "gray"}>{draft.status === "TESTED" ? "Simulado" : "Em revisão"}</Badge></button>)}
      </Stack></Paper>
      <Stack gap="md" miw={0}>
        {!review || !selected ? <Paper withBorder p="xl"><Text c="dimmed">Importe um PDF ou abra uma revisão salva.</Text></Paper> : <>
          <Group justify="space-between"><div><Text fw={700}>{selected.fileName}</Text><Text size="xs" c="dimmed">{changed ? "Alterações não salvas" : "Revisão salva"}</Text></div><Group><Button variant="default" disabled={!canEdit} loading={busy} onClick={() => void save("save")}>Salvar revisão</Button><Button leftSection={<IconPlayerPlay size={16} />} disabled={!canEdit || !connected || optionsLoading || issues.length > 0} loading={busy} onClick={() => void save("simulate")}>Simular com dados do CA</Button></Group></Group>
          {optionsLoading && <Group gap="xs"><Loader size="xs" /><Text size="sm">Consultando categorias e contas do CA…</Text></Group>}
          {issues.length > 0 && <Alert color="orange" title="Conferir antes de simular">{issues.map((issue) => <Text key={issue} size="sm">{issue}</Text>)}</Alert>}
          {review.kind === "INVESTMENT" ? <>
            <Paper withBorder p="md" radius="md"><SimpleGrid cols={{ base: 1, sm: 3 }}><TextInput label="Início do período" type="date" value={review.periodStart} disabled={!canEdit || busy} onChange={(event) => setReview({ ...review, periodStart: event.currentTarget.value })} /><TextInput label="Fim do período" type="date" value={review.periodEnd} disabled={!canEdit || busy} onChange={(event) => setReview({ ...review, periodEnd: event.currentTarget.value })} /><div><Text size="sm" fw={500}>Total dos rendimentos</Text><Title order={3}>{money(review.rows.reduce((sum, row) => sum + row.amountCents, 0))}</Title><Text size="xs" c="dimmed">{review.rows.length} venda(s) consolidada(s)</Text></div></SimpleGrid></Paper>
            {review.rows.map((row, index) => <Paper withBorder p="md" radius="md" key={row.key}>
              <Group justify="space-between" mb="sm"><Text fw={700}>{row.description}</Text><Badge>{row.evidence.length} aplicação(ões)</Badge></Group>
              <SimpleGrid cols={{ base: 1, sm: 2, xl: 4 }}>
                <NumberInput label="Valor consolidado (R$)" decimalScale={2} fixedDecimalScale decimalSeparator="," thousandSeparator="." min={0} value={row.amountCents / 100} disabled={!canEdit || busy} onChange={(value) => setReview({ ...review, rows: review.rows.map((item, i) => i === index ? { ...item, amountCents: Math.round(Number(value) * 100) } : item) })} />
                <TextInput label="Data do rendimento" type="date" value={row.date} disabled={!canEdit || busy} onChange={(event) => setReview({ ...review, rows: review.rows.map((item, i) => i === index ? { ...item, date: event.currentTarget.value } : item) })} />
                <Select label="Categoria de receita no CA" searchable placeholder="Selecione" data={options.categories} value={row.categoryId || null} disabled={!canEdit || optionsLoading || busy} onChange={(value) => setReview({ ...review, rows: review.rows.map((item, i) => i === index ? { ...item, categoryId: value || "" } : item) })} />
                <Select label="Conta de liquidação no CA" searchable placeholder="Selecione" data={options.financialAccounts} value={row.accountId || null} disabled={!canEdit || optionsLoading || busy} onChange={(value) => setReview({ ...review, rows: review.rows.map((item, i) => i === index ? { ...item, accountId: value || "" } : item) })} />
              </SimpleGrid><details className={styles.details}><summary>Conferir valores extraídos</summary>{row.evidence.map((item, i) => <Text key={i} size="sm">Página {item.page} · {money(item.amountCents)} · {item.text}</Text>)}</details>
            </Paper>)}
          </> : <>
            <Paper withBorder p="md" radius="md"><SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput label="Comprador identificado" value={review.buyer} disabled={!canEdit || busy} onChange={(event) => changeContract({ buyer: event.currentTarget.value })} />
              <TextInput label="CPF/CNPJ do comprador" value={review.buyerDocument} disabled={!canEdit || busy} onChange={(event) => changeContract({ buyerDocument: digits(event.currentTarget.value), customerId: "" })} />
              <Select label="Comprador cadastrado no CA" searchable data={options.customers} value={review.customerId || null} placeholder="Localizar pelo CPF/CNPJ do contrato" disabled={!canEdit || optionsLoading || busy} onChange={(value) => changeContract({ customerId: value || "" })} />
              <TextInput label="Serviço (item único)" value={review.description} disabled={!canEdit || busy} onChange={(event) => changeContract({ description: event.currentTarget.value })} />
              <Select label="Categoria de receita no CA" searchable data={options.categories} value={review.categoryId || null} disabled={!canEdit || optionsLoading || busy} onChange={(value) => changeContract({ categoryId: value || "" })} />
              <Select label="Conta financeira no CA" searchable data={options.financialAccounts} value={review.accountId || null} disabled={!canEdit || optionsLoading || busy} onChange={(value) => changeContract({ accountId: value || "" })} />
              <NumberInput label="Valor de cada venda (R$)" value={review.amountCents / 100} decimalScale={2} fixedDecimalScale decimalSeparator="," thousandSeparator="." min={0} disabled={!canEdit || busy} onChange={(value) => changeContract({ amountCents: Math.round(Number(value) * 100) })} />
              <NumberInput label="Valor total do contrato (R$)" value={review.totalCents / 100} decimalScale={2} fixedDecimalScale decimalSeparator="," thousandSeparator="." min={0} disabled={!canEdit || busy} onChange={(value) => changeContract({ totalCents: Math.round(Number(value) * 100) })} />
              <Select label="Forma de pagamento" data={paymentOptions} value={review.paymentMethod || null} disabled={!canEdit || busy} onChange={(value) => changeContract({ paymentMethod: (value || "") as ContractReview["paymentMethod"] })} />
              <TextInput label="Data original do documento" type="date" value={review.originalDate} disabled={!canEdit || busy} onChange={(event) => changeContract({ originalDate: event.currentTarget.value })} />
            </SimpleGrid></Paper>
            <Paper withBorder p="md" radius="md"><Text fw={700} mb="md">Programação das vendas</Text><SimpleGrid cols={{ base: 1, sm: 2, xl: 3 }}>
              <TextInput label="Mês de início das vendas" type="month" value={review.startMonth.slice(0, 7)} disabled={!canEdit || busy} onChange={(event) => { const month = event.currentTarget.value; changeContract({ startMonth: month ? month + "-01" : "", firstDueDate: month ? monthDate(month + "-01", 0, review.dueDay || 1) : "" }); }} />
              <TextInput label="Dia de geração das vendas" value="01" readOnly />
              <NumberInput label="Vencer sempre no dia" value={review.dueDay || ""} min={1} max={31} allowDecimal={false} disabled={!canEdit || busy} onChange={(value) => changeContract({ dueDay: Number(value), firstDueDate: monthDate(review.startMonth, 0, Number(value) || 1) })} />
              <NumberInput label="Quantidade de cobranças" value={review.installments || ""} min={1} max={240} allowDecimal={false} disabled={!canEdit || busy} onChange={(value) => changeContract({ installments: Number(value) })} />
              <NumberInput label="Repetir a cada" value={review.interval} min={1} max={120} allowDecimal={false} disabled={!canEdit || busy} onChange={(value) => changeContract({ interval: Number(value) || 1 })} />
              <Select label="Periodicidade" data={[{ value: "MONTHLY", label: "Mês/meses" }, { value: "YEARLY", label: "Ano/anos" }]} value={review.frequency} disabled={!canEdit || busy} onChange={(value) => changeContract({ frequency: value as ContractReview["frequency"] })} />
            </SimpleGrid><Group mt="md"><Badge variant="light">Primeiro vencimento: {displayDate(review.firstDueDate)}</Badge><Badge variant="light">Término: {planned.length ? displayDate(monthDate(planned[planned.length - 1].saleDate, 0, "last")) : "—"}</Badge><Badge variant="light">Total previsto: {money(planned.reduce((sum, row) => sum + row.amountCents, 0))}</Badge></Group><ScheduleTable sales={planned} /></Paper>
          </>}
          {review.warnings.length > 0 && <details className={styles.details}><summary>Observações da leitura ({review.warnings.length})</summary>{review.warnings.map((warning, i) => <Text key={i} size="sm">{warning}</Text>)}</details>}
          {review.kind === "CONTRACT" && <Text size="sm" c="dimmed">Boleto e NF automáticos: configurar diretamente no Conta Azul. Escolher boleto como forma de pagamento não ativa a emissão automática.</Text>}
        </>}
      </Stack>
    </div>}
    <Modal opened={preview} onClose={() => setPreview(false)} title="Resultado da simulação" size="xl"><Stack>{selected?.simulation && <>
      <Alert color={selected.simulation.errors.length ? "orange" : "teal"}>{selected.simulation.errors.length ? "Há pendências para corrigir." : "Dados conferidos com os cadastros do CA."} Nenhuma venda, contrato ou baixa foi criada.</Alert>
      {selected.simulation.errors.map((issue) => <Text key={issue} size="sm" c="red">{issue}</Text>)}<ScheduleTable sales={selected.simulation.sales} /><Text fw={700}>Total: {money(selected.simulation.totalCents)}</Text>
      {selected.simulation.endDate && <Text>Término da recorrência: {displayDate(selected.simulation.endDate)}</Text>}
      <Text size="sm" c="dimmed">Esta etapa testa leitura, cálculos e vínculos. O envio real ao CA ainda não está habilitado.</Text>
    </>}</Stack></Modal>
  </Stack>;
}
function ScheduleTable({ sales }: { sales: Sale[] }) { return <ScrollArea mah={400} mt="md"><Table striped withTableBorder><Table.Thead><Table.Tr><Table.Th>Venda</Table.Th><Table.Th>Geração</Table.Th><Table.Th>Vencimento</Table.Th><Table.Th>Valor</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{sales.map((sale) => <Table.Tr key={sale.number}><Table.Td>{sale.number}{sale.description ? ` · ${sale.description}` : ""}</Table.Td><Table.Td>{displayDate(sale.saleDate)}</Table.Td><Table.Td>{displayDate(sale.dueDate)}</Table.Td><Table.Td>{money(sale.amountCents)}</Table.Td></Table.Tr>)}</Table.Tbody></Table></ScrollArea>; }
