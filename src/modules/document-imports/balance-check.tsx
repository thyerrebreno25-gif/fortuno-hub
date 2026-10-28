/* eslint-disable react-hooks/set-state-in-effect */
"use client";
import { useEffect, useState } from "react";
import { Badge, Button, Group, Loader, Stack, Text } from "@mantine/core";
import { type InvestmentReview, type Option, displayDate, money, validDate } from "./model";
import { type AccountClosingBalance, compareBalances } from "./balance-model";
export function BalanceCheck({ review, clientId, accounts, connected }: { review: InvestmentReview; clientId: string; accounts: Option[]; connected: boolean }) {
  const accountIds = [...new Set(review.rows.map((row) => row.accountId).filter(Boolean))].sort();
  const key = JSON.stringify([clientId, review.periodEnd, accountIds]);
  const [result, setResult] = useState<{ key: string; balances: AccountClosingBalance[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    // The response key prevents showing a previous company's/date's balance.
    if (!connected || !validDate(review.periodEnd) || !accountIds.length) { setLoading(false); return; }
    const timer = window.setTimeout(() => {
      setLoading(true); setError("");
      fetch("/api/document-imports/balances", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, date: review.periodEnd, accountIds }), signal: controller.signal }).then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Não foi possível consultar os saldos.");
        if (active) setResult({ key, balances: body.balances });
      }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Não foi possível consultar os saldos."); }).finally(() => { if (active) setLoading(false); });
    }, 500);
    return () => { active = false; controller.abort(); window.clearTimeout(timer); };
    // Account IDs are represented by key; income edits only recalculate the comparison.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, connected, refresh]);
  const comparisons = compareBalances(review, connected && !loading && !error && result?.key === key ? result.balances : []);
  return <Stack gap="xs">
    <Group justify="space-between"><Text size="sm" fw={600}>Validação de saldo</Text>{loading && <Loader size="xs" />}</Group>
    {!accountIds.length && <Text size="xs" c="dimmed">Selecione as contas de aplicação abaixo para conferir o saldo no fim do período.</Text>}
    {accountIds.length > 0 && review.rows.some((row) => !row.accountId) && <Text size="xs" c="orange">Há tipos de aplicação ainda sem conta selecionada.</Text>}
    {comparisons.map((comparison) => <Stack gap={3} key={comparison.accountId}>
      <Text size="xs" fw={700}>{accounts.find((item) => item.value === comparison.accountId)?.label || "Conta selecionada"}</Text>
      <Badge size="sm" color={comparison.status === "OK" ? "green" : comparison.status === "DIVERGENT" ? "red" : "orange"}>{loading ? "Consultando" : comparison.status === "OK" ? "Saldo confere após rendimento" : comparison.status === "ALREADY_MATCHES" ? "Saldo já confere sem novo lançamento" : comparison.status === "DIVERGENT" ? "Saldo divergente" : "Não validado"}</Badge>
      <Text size="xs">CA em {displayDate(review.periodEnd)}: <strong>{comparison.caCents === null ? "Indisponível" : money(comparison.caCents)}</strong></Text>
      <Text size="xs">Após rendimento: {comparison.projectedCents === null ? "—" : money(comparison.projectedCents)}</Text>
      <Text size="xs">Extrato bruto: {comparison.statementCents === null ? "Não identificado" : money(comparison.statementCents)}</Text>
      {comparison.differenceCents !== null && <Text size="xs" c={comparison.differenceCents ? "red" : "green"}>Diferença após rendimento: {money(comparison.differenceCents)}</Text>}
      {comparison.source && <Text size="xs" c="dimmed">{comparison.source.method === "RECONSTRUCTED" ? "Saldo reconstruído pelos movimentos posteriores." : comparison.source.method === "CURRENT" ? "Saldo até o horário da consulta, período ainda em curso." : comparison.source.reason}</Text>}
      {comparison.status === "ALREADY_MATCHES" && <Text size="xs" c="orange">Confira se o rendimento já foi registrado antes de lançar novamente.</Text>}
    </Stack>)}
    {error && <Text size="xs" c="red">{error}</Text>}
    {accountIds.length > 0 && <Button variant="subtle" size="compact-xs" disabled={loading || !connected} onClick={() => { setResult(null); setRefresh((value) => value + 1); }}>Atualizar conferência</Button>}
  </Stack>;
}
