"use client";
import { useId, useState, type ReactNode } from "react";
import { Button, Collapse, Group, Paper, Text } from "@mantine/core";
import { IconChevronDown, IconChevronUp } from "@tabler/icons-react";

export function CollapsibleOperationFilters({ title, summary, children }: { title: string; summary: string; children: ReactNode }) {
  const [opened, setOpened] = useState(true);
  const id = useId();
  return <Paper withBorder radius="lg" p="md">
    <Group justify="space-between" gap="xs">
      <div><Text fw={600}>{title}</Text>{!opened && <Text size="xs" c="dimmed">{summary}</Text>}</div>
      <Button size="xs" variant="subtle" aria-expanded={opened} aria-controls={id} rightSection={opened ? <IconChevronUp size={16}/> : <IconChevronDown size={16}/>} onClick={() => setOpened(value => !value)}>{opened ? "Recolher filtros" : "Mostrar filtros"}</Button>
    </Group>
    <Collapse expanded={opened} id={id}><div style={{paddingTop:12}}>{children}</div></Collapse>
  </Paper>;
}
