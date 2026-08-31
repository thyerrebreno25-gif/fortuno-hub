"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, Button, Group, Loader, Paper, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconArrowRight, IconBell, IconClock, IconNotes } from "@tabler/icons-react";
import styles from "./notice-home-panel.module.css";

type HomeNotice = {
  id: string;
  kind: "ALERT" | "REMINDER" | "NOTE";
  priority: "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
  title: string;
  dueAt: string | null;
  clients: Array<{ id: string; name: string }>;
  mine: { viewedAt: string | null; completedAt: string | null } | null;
};

const colors = {
  LOW: "gray",
  NORMAL: "blue",
  HIGH: "orange",
  CRITICAL: "red",
};

function shortDate(value: string | null) {
  if (!value) return "Sem prazo";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
  }).format(new Date(value));
}

export function NoticeHomePanel() {
  const [notices, setNotices] = useState<HomeNotice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch("/api/notices?view=summary&status=active&limit=3", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Avisos indisponíveis.");
        if (!active) return;
        const rows = (payload.notices || []) as HomeNotice[];
        setNotices(rows);

        rows
          .filter((notice) => notice.mine && !notice.mine.viewedAt)
          .forEach((notice) => {
            void fetch(`/api/notices/${notice.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "viewed" }),
            });
          });
      })
      .catch(() => {
        if (active) setNotices([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <Paper withBorder radius="lg" p="md" className={styles.panel}>
      <Group justify="space-between" mb="sm">
        <Group gap={8}>
          <ThemeIcon variant="light" radius="md"><IconBell size={18} /></ThemeIcon>
          <div>
            <Text fw={800} size="sm">Avisos importantes</Text>
            <Text size="xs" c="dimmed">Pendências direcionadas a você</Text>
          </div>
        </Group>
        {notices.length > 0 && <Badge circle>{notices.length}</Badge>}
      </Group>

      {loading ? (
        <Group justify="center" py="lg"><Loader size="sm" /></Group>
      ) : notices.length === 0 ? (
        <div className={styles.empty}>
          <Text size="sm" fw={700}>Tudo em dia</Text>
          <Text size="xs" c="dimmed">Nenhum aviso pendente no momento.</Text>
        </div>
      ) : (
        <Stack gap={7}>
          {notices.map((notice) => {
            const Icon = notice.kind === "NOTE" ? IconNotes : notice.kind === "REMINDER" ? IconClock : IconBell;
            return (
              <Link key={notice.id} href="/avisos" className={styles.noticeLink}>
                <ThemeIcon size={32} radius="md" variant="light" color={colors[notice.priority]}>
                  <Icon size={16} />
                </ThemeIcon>
                <div className={styles.noticeText}>
                  <Text size="xs" fw={800} lineClamp={1}>{notice.title}</Text>
                  <Text size="xs" c="dimmed" lineClamp={1}>
                    {notice.clients[0]?.name || "Pessoal"} · {shortDate(notice.dueAt)}
                  </Text>
                </div>
              </Link>
            );
          })}
        </Stack>
      )}

      <Button
        component={Link}
        href="/avisos"
        variant="subtle"
        size="compact-sm"
        fullWidth
        mt="sm"
        rightSection={<IconArrowRight size={14} />}
      >
        Abrir Central de Avisos
      </Button>
    </Paper>
  );
}
