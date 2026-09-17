"use client";

import { useState } from "react";
import { Button, Modal, Stack, Text } from "@mantine/core";
import { IconBrain } from "@tabler/icons-react";
import { CategoryLearningDialog, CategoryLearningPreviewCard } from "@/modules/assistant/category-learning-ui";
import type { CategoryHistoryView } from "@/modules/assistant/category-history";

const apiEndpoint = "/api/card-invoices/category-learning";
const noRefresh = async () => {};
export function InvoiceHistoryLearning(props: {
  clientId: string; clientName: string; connected: boolean; disabled: boolean;
  onBusy: (busy: boolean) => void; onLearned: () => Promise<void>;
}) {
  const [opened, setOpened] = useState(false);
  const [reviewOpened, setReviewOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<{ conversationId: string; previewMessageId: string; preview: CategoryHistoryView } | null>(null);
  function onBusy(value: boolean) { setBusy(value); props.onBusy(value); }
  return <>
    <Button variant="light" leftSection={<IconBrain size={17} />} disabled={props.disabled || !props.connected || busy}
      title={!props.connected ? "Conecte este cliente ao Conta Azul para aprender pelo histórico." : "Aprenda categorias do histórico e preencha os itens pendentes desta fatura."}
      onClick={() => { if (session && !session.preview.savedAt) setReviewOpened(true); else setOpened(true); }}>Aprender categorias</Button>
    {opened && <CategoryLearningDialog opened onClose={() => setOpened(false)} conversationId="" clientId={props.clientId}
      clientName={props.clientName} apiEndpoint={apiEndpoint} onBusy={onBusy} onRefresh={noRefresh}
      onPreview={(result) => { setSession(result); setReviewOpened(true); }} />}
    <Modal opened={reviewOpened} onClose={() => { if (!busy) setReviewOpened(false); }} title="Revisar aprendizado de categorias"
      size="xl" closeOnClickOutside={!busy} closeOnEscape={!busy} withCloseButton={!busy}>
      <Stack>
        <Text size="sm">Após confirmar, o aprendizado será aplicado aos itens pendentes da fatura aberta. Categorias já preenchidas e edições manuais serão preservadas.</Text>
        {session && <CategoryLearningPreviewCard key={session.previewMessageId} conversationId={session.conversationId}
          messageId={session.previewMessageId} preview={session.preview} apiEndpoint={apiEndpoint} disabled={false}
          onRefresh={noRefresh} onBusy={onBusy} onConfirmed={async () => {
            await props.onLearned();
            setSession(null);
            setReviewOpened(false);
          }} />}
        <Button variant="default" disabled={busy} onClick={() => setReviewOpened(false)}>Fechar</Button>
        {session && <Button variant="subtle" disabled={busy} onClick={() => { setSession(null); setReviewOpened(false); setOpened(true); }}>Consultar outro período ou conta</Button>}
      </Stack>
    </Modal>
  </>;
}
