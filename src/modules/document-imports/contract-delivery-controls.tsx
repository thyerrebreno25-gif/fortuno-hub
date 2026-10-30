"use client";
import { useState } from "react";
import { Alert, Badge, Button, Checkbox, Group, Modal, Stack, Text } from "@mantine/core";
import { displayDate, money, monthDate, schedule, type ContractReview, type Option } from "./model";
import type { DeliveryDraft } from "./delivery-controls";
export function ContractDeliveryControls({ draft, review, companyName, clientId, customers, services, accounts, categories, canSend, busy, dirty, onBusy, onResult }: {
  draft: DeliveryDraft; review: ContractReview; companyName: string; clientId: string; customers: Option[]; services: Option[]; accounts: Option[]; categories: Option[];
  canSend: boolean; busy: boolean; dirty: boolean; onBusy: (value: boolean) => void; onResult: (draft: unknown, message: string, error: string) => void;
}) {
  const [opened,setOpened] = useState(false), [confirmed,setConfirmed] = useState(false);
  const delivery = draft.deliveries?.[0], completed = delivery?.status === "SENT";
  const sales = schedule(review);
  const end = sales.length ? monthDate(sales.at(-1)!.saleDate,0,"last") : "";
  async function send(verifyOnly = false) {
    if (!verifyOnly && !confirmed) return;
    setOpened(false); onBusy(true);
    let updated: unknown = null, message = "", failure = "";
    try {
      const response = await fetch(`/api/document-imports/${draft.id}/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "CONTRACT", version: draft.version, confirmation: verifyOnly ? "VERIFICAR NO CA" : "ENVIAR AO CA" }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível confirmar o envio.");
      updated = data.draft; message = data.completed ? "Contrato criado e confirmado no Conta Azul. As vendas seguem a recorrência configurada." : "Contrato criado. Aguarde a consulta de confirmação no CA e use Verificar envio.";
    } catch (error) {
      failure = error instanceof Error ? error.message : "Não foi possível concluir o envio.";
      try { const response = await fetch(`/api/document-imports?kind=CONTRACT&clientId=${encodeURIComponent(clientId)}`,{cache:"no-store"}); if(response.ok) { const data=await response.json(); updated=data.drafts.find((item:DeliveryDraft)=>item.id===draft.id); } } catch { /* Keep the saved review if refresh fails. */ }
    } finally { onResult(updated,message,failure); onBusy(false); }
  }
  return <Stack gap="xs"><Group><Button color="green" loading={busy} disabled={busy || dirty || completed || !canSend} onClick={()=>{if(delivery?.contractId){void send(true);return;}setConfirmed(false);setOpened(true);}}>{completed ? "Contrato enviado ao CA" : delivery?.contractId ? "Verificar confirmação no CA" : delivery ? "Verificar / retomar envio" : "Enviar contrato ao CA"}</Button>{dirty && <Text size="xs" c="dimmed">Salve a revisão antes de enviar.</Text>}</Group>
    {delivery && <Alert color={completed ? "green" : "orange"} title={completed ? "Contrato confirmado no CA" : "Andamento do contrato"}><Group gap="xs"><Badge color={completed ? "green" : "orange"}>{completed ? "Enviado" : delivery.status === "CONTRACT_CREATED" ? "Criado · confirmação pendente" : delivery.status === "UNCERTAIN_CONTRACT" || delivery.status === "CREATING" ? "Criação não confirmada" : delivery.status === "FAILED" ? "CA rejeitou a criação" : "Aguardando"}</Badge>{delivery.contractNumber && <Text size="sm">Contrato {delivery.contractNumber}</Text>}</Group>{delivery.contractId && <Text size="xs" mt="xs">ID no CA: {delivery.contractId}</Text>}{delivery.lastError && <Text size="sm" mt="xs">{delivery.lastError}</Text>}</Alert>}
    <Modal opened={opened} onClose={()=>!busy&&setOpened(false)} title="Confirmar envio real do contrato" size="lg"><Stack>
      <Text fw={750}>{companyName}</Text><Text>Comprador: {customers.find(item=>item.value===review.customerId)?.label || review.buyer}</Text><Text>Serviço: {services.find(item=>item.value===review.serviceId)?.label || "Não selecionado"}</Text><Text>{review.description}</Text>
      {!review.customerId && review.autoCreateBuyer !== false && <Alert color="teal">O Hub consultará o CPF/CNPJ {review.buyerDocument} e, se não houver cadastro, criará o comprador com os dados revisados antes de enviar o contrato.{review.buyerEmail ? ` E-mail: ${review.buyerEmail}.` : ""}{review.buyerPhone ? ` Telefone: ${review.buyerPhone}.` : ""}</Alert>}
      <Text>Categoria: {categories.find(item=>item.value===review.categoryId)?.label || "Não selecionada"}</Text><Text>Conta: {accounts.find(item=>item.value===review.accountId)?.label || "Não selecionada"}</Text><Text>Pagamento: {({BOLETO_BANCARIO:"Boleto bancário",PIX_PAGAMENTO_INSTANTANEO:"Pix",TRANSFERENCIA_BANCARIA:"Transferência bancária",CARTAO_CREDITO:"Cartão de crédito",OUTRO:"Outro"} as Record<string,string>)[review.paymentMethod]}</Text>
      <Text>{review.installments} cobranças de {money(review.amountCents)} · Total: {money(review.totalCents)}</Text><Text>Início: {displayDate(review.startMonth)} · Geração: dia 01</Text><Text>Primeiro vencimento: {displayDate(review.firstDueDate)} · Vencer no dia {review.dueDay}</Text><Text>Repetir a cada {review.interval} {review.frequency === "YEARLY" ? "ano(s)" : "mês/meses"} · Término: {displayDate(end)}</Text>
      <Alert color="blue">O CA criará um contrato recorrente e gerará as vendas conforme essa programação. Este envio não registra baixas. Emissão automática de boleto e NF deve ser configurada no Conta Azul.</Alert>
      <Checkbox checked={confirmed} onChange={e=>setConfirmed(e.currentTarget.checked)} label="Conferi a empresa, os dados do comprador, os valores e as datas e confirmo o cadastro do comprador, se necessário, e o envio real do contrato ao CA." />
      <Group justify="flex-end"><Button variant="default" onClick={()=>setOpened(false)}>Cancelar</Button><Button color="green" disabled={!confirmed} onClick={()=>void send()}>Confirmar envio ao CA</Button></Group>
    </Stack></Modal>
  </Stack>;
}
