"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ActionIcon, Button, Group, Loader, Text } from "@mantine/core";
import { IconArrowsMaximize, IconMessageCircle, IconX } from "@tabler/icons-react";
import styles from "./floating.module.css";
const AssistantChat = dynamic(() => import("./chat"), { ssr: false, loading: () => <Group justify="center" p="xl"><Loader /></Group> });
export function FloatingAssistant() {
  const [opened, setOpened] = useState(false), [initialized, setInitialized] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  function close() { setOpened(false); trigger.current?.focus(); }
  useEffect(() => {
    if (!opened) return;
    panel.current?.focus();
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" && !document.querySelector('[data-portal] [role="dialog"]')) { setOpened(false); trigger.current?.focus(); } };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [opened]);
  return <>
    {initialized && <div className={styles.panel} hidden={!opened} role="region" aria-label="Conversa com a Assistente Fortuno" id="floating-assistant" ref={panel} tabIndex={-1}>
      <Group justify="space-between" className={styles.header}><div><Text fw={800} size="sm">Assistente Fortuno</Text><Text size="xs" c="dimmed">Consulte clientes, Conta Azul e Notion</Text></div><Group gap={4}><ActionIcon component={Link} href="/assistente" variant="subtle" aria-label="Abrir assistente em tela completa" onClick={close}><IconArrowsMaximize size={17} /></ActionIcon><ActionIcon variant="subtle" aria-label="Fechar assistente" onClick={close}><IconX size={19} /></ActionIcon></Group></Group>
      <div className={styles.content}><AssistantChat embedded /></div>
    </div>}
    <Button ref={trigger} className={styles.trigger} radius="xl" size="md" leftSection={<IconMessageCircle size={22} />} aria-expanded={opened} aria-controls={initialized ? "floating-assistant" : undefined} onClick={() => { if (opened) close(); else { setInitialized(true); setOpened(true); } }}>Assistente</Button>
  </>;
}
