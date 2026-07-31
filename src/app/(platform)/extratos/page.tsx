"use client";

import { useMemo, useRef, useState } from "react";
import { ActionIcon, Alert, Badge, Button, Card, Center, Checkbox, Group, NumberInput, Paper, Progress, ScrollArea, Select, SimpleGrid, Stack, Table, Text, ThemeIcon, Title } from "@mantine/core";
import { IconAlertTriangle, IconArrowDown, IconArrowUp, IconBuildingBank, IconCheck, IconChevronRight, IconDownload, IconFileAnalytics, IconPhoto, IconRefresh, IconTrash, IconUpload, IconX } from "@tabler/icons-react";
import { extractPdfLines } from "@/modules/bank-statements/pdf-reader.client";
import { parseSicredi } from "@/modules/bank-statements/parsers/sicredi";
import { generateOfx } from "@/modules/bank-statements/ofx";
import type { ParsedStatement, StatementTransaction } from "@/modules/bank-statements/types";
import { trackImport } from "@/modules/imports/import-tracker";

const BANKS = [{ value: "SICREDI", label: "Sicredi" }, { value: "BB", label: "Banco do Brasil (em breve)" }, { value: "ITAU", label: "Itaú (em breve)" }, { value: "INTER", label: "Inter (em breve)" }];
const money = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
const date = (v?: string) => v ? v.split("-").reverse().join("/") : "-";
function download(name: string, content: string, type: string) { const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); }

export default function ExtratosPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [bank, setBank] = useState<string | null>("SICREDI");
  const [file, setFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [statement, setStatement] = useState<ParsedStatement | null>(null);
  const [initialBalance, setInitialBalance] = useState<number | string>("");
  const [transactions, setTransactions] = useState<StatementTransaction[]>([]);

  const totals = useMemo(() => {
    const selected = transactions.filter((t) => t.selected);
    const credits = selected.filter((t) => t.type === "CREDIT").reduce((s, t) => s + t.amount, 0);
    const debits = selected.filter((t) => t.type === "DEBIT").reduce((s, t) => s + t.amount, 0);
    const calculated = Number(initialBalance || 0) + credits - debits;
    const detected = statement?.detectedClosingBalance ?? 0;
    return { count: selected.length, credits, debits, calculated, detected, difference: calculated - detected };
  }, [transactions, initialBalance, statement]);
  const balanceValid = initialBalance !== "" && Math.abs(totals.difference) < 0.01;

  async function processFile() {
    if (!file || !bank) return;
    setProcessing(true); setError("");
    try {
      if (bank !== "SICREDI") throw new Error("A lógica disponível nesta versão é a do Sicredi.");
      if (file.type.startsWith("image/") || /\.(png|jpe?g)$/i.test(file.name)) throw new Error("A leitura por imagem será ativada no parser Sicredi na próxima etapa de OCR. Este primeiro layout já está funcional para PDF.");
      const parsed = parseSicredi(await extractPdfLines(file));
      setStatement(parsed); setTransactions(parsed.transactions); setInitialBalance("");
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível ler o arquivo."); }
    finally { setProcessing(false); }
  }
  function reset() { setFile(null); setStatement(null); setTransactions([]); setInitialBalance(""); setError(""); if (fileInputRef.current) fileInputRef.current.value = ""; }
  function toggle(id: number, selected: boolean) { setTransactions((c) => c.map((t) => t.id === id ? { ...t, selected } : t)); }
  function remove(id: number) { setTransactions((c) => c.filter((t) => t.id !== id)); }
  async function exportOfx() {
    if (!statement || initialBalance === "") return;
    const content = generateOfx({ bankId: "748", branch: statement.branch, account: statement.account, initialBalance: Number(initialBalance), finalBalance: totals.calculated, transactions });
    download(`sicredi_${statement.account || "extrato"}_${statement.periodStart || ""}.ofx`, content, "application/x-ofx;charset=utf-8");
    try {
      await trackImport({
        module: "BANK_STATEMENT",
        status: "EXPORTED",
        originalName: file?.name || `sicredi_${statement.account || "extrato"}.pdf`,
        parserId: "sicredi-conta-corrente",
        parserVersion: "1.0.0",
        expectedTotal: totals.detected,
        parsedTotal: totals.calculated,
        difference: totals.difference,
        metadata: {
          bank: statement.bank,
          branch: statement.branch,
          account: statement.account,
          accountHolder: statement.accountHolder,
          openingBalance: Number(initialBalance),
          closingBalance: totals.calculated,
          transactionCount: totals.count,
          exportFormat: "OFX",
        },
        transactions: transactions.filter((item) => item.selected).map((item) => ({
          date: item.date,
          description: item.description,
          amount: item.amount,
          type: item.type,
          document: item.document,
          metadata: { balance: item.balance },
        })),
      });
    } catch (trackingError) {
      console.error("OFX gerado, mas o histórico não foi salvo:", trackingError);
    }
  }

  return <Stack gap="xl">
    <Group justify="space-between" align="flex-end"><Stack gap={4}><Text size="xs" fw={800} c="blue" tt="uppercase">Importações</Text><Title order={2}>Extratos bancários</Title><Text c="dimmed">Selecione o banco, envie o arquivo e confira o fechamento antes de gerar o OFX.</Text></Stack>{statement && <Button variant="default" leftSection={<IconRefresh size={17}/>} onClick={reset}>Novo processamento</Button>}</Group>

    {!statement ? <Paper withBorder radius="xl" p={{ base: "lg", md: 40 }}><Stack gap="xl">
      <Center><Stack align="center" gap="sm"><ThemeIcon size={68} radius="xl" variant="light"><IconUpload size={34}/></ThemeIcon><Title order={3}>Importe o extrato bancário</Title><Text c="dimmed" ta="center">O banco é selecionado manualmente. Cada opção utiliza uma lógica própria de leitura.</Text></Stack></Center>
      <Select label="Banco *" description="Escolha o banco antes de anexar o arquivo." data={BANKS} value={bank} onChange={setBank} searchable required maw={520}/>
      <Paper withBorder radius="xl" p={34} style={{ borderStyle: "dashed" }}><Stack align="center"><Group><Badge leftSection={<IconFileAnalytics size={13}/>}>PDF</Badge><Badge leftSection={<IconPhoto size={13}/>} variant="light">JPG / PNG</Badge></Group><input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" hidden onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}/><Button leftSection={<IconUpload size={18}/>} onClick={() => fileInputRef.current?.click()}>Selecionar arquivo</Button><Text size="sm" c="dimmed">Layout ativo: Sicredi - Extrato de conta corrente.</Text></Stack></Paper>
      {file && <Card withBorder><Group justify="space-between"><Stack gap={0}><Text fw={700}>{file.name}</Text><Text size="sm" c="dimmed">{(file.size/1024/1024).toFixed(2)} MB</Text></Stack><ActionIcon color="red" variant="subtle" onClick={()=>{setFile(null);if (fileInputRef.current) fileInputRef.current.value = "";}}><IconX size={18}/></ActionIcon></Group></Card>}
      {error && <Alert color="red" icon={<IconAlertTriangle size={18}/>}>{error}</Alert>}
      <Alert color="blue">O saldo inicial será digitado manualmente depois da leitura. O sistema somará entradas e subtrairá saídas para comparar o saldo final calculado com o saldo final apresentado no extrato.</Alert>
      <Group justify="flex-end"><Button disabled={!file || !bank} loading={processing} onClick={processFile} rightSection={<IconChevronRight size={18}/>}>Ler extrato</Button></Group>
    </Stack></Paper> : <>
      <SimpleGrid cols={{ base:1, sm:2, xl:4 }}>
        <Paper withBorder radius="lg" p="lg"><Group justify="space-between"><Stack gap={2}><Text size="sm" c="dimmed">Banco selecionado</Text><Text fw={800} fz={22}>{statement.bank}</Text><Badge color="green">Layout validado</Badge></Stack><ThemeIcon variant="light" size={44}><IconBuildingBank size={23}/></ThemeIcon></Group></Paper>
        <Paper withBorder radius="lg" p="lg"><Stack gap={2}><Text size="sm" c="dimmed">Conta</Text><Text fw={800}>{statement.accountHolder || "-"}</Text><Text size="sm">Cooperativa {statement.branch || "-"} · Conta {statement.account || "-"}</Text></Stack></Paper>
        <Paper withBorder radius="lg" p="lg"><Stack gap={2}><Text size="sm" c="dimmed">Período</Text><Text fw={800}>{date(statement.periodStart)} a {date(statement.periodEnd)}</Text><Text size="sm" c="dimmed">{transactions.length} movimentações lidas</Text></Stack></Paper>
        <Paper withBorder radius="lg" p="lg"><Stack gap={2}><Text size="sm" c="dimmed">Saldo final do extrato</Text><Text fw={800} fz={24}>{money(statement.detectedClosingBalance || 0)}</Text><Badge color={balanceValid ? "green" : "orange"}>{balanceValid ? "Fechamento confirmado" : "Aguardando conferência"}</Badge></Stack></Paper>
      </SimpleGrid>

      <Paper withBorder radius="lg" p="lg"><Stack gap="lg"><Group justify="space-between"><Stack gap={2}><Title order={4}>Conferência do saldo</Title><Text size="sm" c="dimmed">Informe o saldo anterior para validar automaticamente o fechamento.</Text></Stack><Badge color={balanceValid ? "green" : "orange"}>{balanceValid ? "Saldo bateu" : "Saldo divergente ou não informado"}</Badge></Group>
        <SimpleGrid cols={{base:1,md:3}}><NumberInput label="Saldo inicial informado *" placeholder="R$ 0,00" value={initialBalance} onChange={setInitialBalance} prefix="R$ " decimalScale={2} fixedDecimalScale thousandSeparator="." decimalSeparator=","/><NumberInput label="Saldo anterior detectado (referência)" value={statement.detectedOpeningBalance || 0} readOnly prefix="R$ " decimalScale={2} fixedDecimalScale thousandSeparator="." decimalSeparator=","/><NumberInput label="Saldo final identificado" value={statement.detectedClosingBalance || 0} readOnly prefix="R$ " decimalScale={2} fixedDecimalScale thousandSeparator="." decimalSeparator=","/></SimpleGrid>
        <SimpleGrid cols={{base:2,md:5}}><Card withBorder><Group gap="xs"><IconArrowUp size={18}/><Stack gap={0}><Text size="xs">Entradas</Text><Text fw={800}>{money(totals.credits)}</Text></Stack></Group></Card><Card withBorder><Group gap="xs"><IconArrowDown size={18}/><Stack gap={0}><Text size="xs">Saídas</Text><Text fw={800}>{money(totals.debits)}</Text></Stack></Group></Card><Card withBorder><Stack gap={0}><Text size="xs">Saldo calculado</Text><Text fw={800}>{money(totals.calculated)}</Text></Stack></Card><Card withBorder><Stack gap={0}><Text size="xs">Saldo do extrato</Text><Text fw={800}>{money(totals.detected)}</Text></Stack></Card><Card withBorder><Stack gap={0}><Text size="xs">Diferença</Text><Text fw={800} c={balanceValid?"green":"orange"}>{money(totals.difference)}</Text></Stack></Card></SimpleGrid>
        <Progress value={balanceValid ? 100 : initialBalance === "" ? 0 : 60} color={balanceValid ? "green" : "orange"}/>
      </Stack></Paper>

      <Paper withBorder radius="lg"><Group p="lg" justify="space-between"><Stack gap={2}><Title order={4}>Movimentações extraídas</Title><Text size="sm" c="dimmed">Valores positivos são entradas e valores negativos são saídas.</Text></Stack><Badge>{totals.count} selecionadas</Badge></Group><ScrollArea><Table miw={1000} verticalSpacing="sm"><Table.Thead><Table.Tr><Table.Th></Table.Th><Table.Th>Data</Table.Th><Table.Th>Descrição</Table.Th><Table.Th>Documento</Table.Th><Table.Th>Tipo</Table.Th><Table.Th ta="right">Valor</Table.Th><Table.Th ta="right">Saldo</Table.Th><Table.Th></Table.Th></Table.Tr></Table.Thead><Table.Tbody>{transactions.map(t=><Table.Tr key={t.id}><Table.Td><Checkbox checked={t.selected} onChange={e=>toggle(t.id,e.currentTarget.checked)}/></Table.Td><Table.Td>{date(t.date)}</Table.Td><Table.Td><Text fw={600}>{t.description}</Text></Table.Td><Table.Td>{t.document || "-"}</Table.Td><Table.Td><Badge color={t.type==="CREDIT"?"green":"red"} variant="light">{t.type==="CREDIT"?"Entrada":"Saída"}</Badge></Table.Td><Table.Td ta="right">{money(t.amount)}</Table.Td><Table.Td ta="right">{t.balance===null?"-":money(t.balance)}</Table.Td><Table.Td><ActionIcon color="red" variant="subtle" onClick={()=>remove(t.id)}><IconTrash size={17}/></ActionIcon></Table.Td></Table.Tr>)}</Table.Tbody></Table></ScrollArea></Paper>
      <Paper withBorder radius="lg" p="lg"><Group justify="space-between"><Alert color={balanceValid ? "green" : "orange"} icon={balanceValid?<IconCheck size={18}/>:<IconAlertTriangle size={18}/>}>{balanceValid ? "Saldo inicial + entradas - saídas = saldo final do extrato. O OFX está liberado." : "Informe o saldo inicial correto e confira se a diferença fica zerada."}</Alert><Button leftSection={<IconDownload size={18}/>} disabled={!balanceValid} onClick={exportOfx}>Gerar OFX</Button></Group></Paper>
    </>}
  </Stack>;
}
