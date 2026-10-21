"use client";
import { Badge, Button, Group, Paper, Progress, Select, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { gutImpact, gutScore, rankGut, type GutActivity } from "./gut";

const dimensions = [
  { key: "gravity", label: "Gravidade", guide: "1 · Sem gravidade|2 · Pouco grave|3 · Grave|4 · Muito grave|5 · Extremamente grave" },
  { key: "urgency", label: "Urgência", guide: "1 · Pode esperar|2 · Pouco urgente|3 · O quanto antes|4 · Urgente|5 · Ação imediata" },
  { key: "tendency", label: "Tendência", guide: "1 · Não piora|2 · Piora a longo prazo|3 · Piora a médio prazo|4 · Piora a curto prazo|5 · Piora rapidamente" },
] as const;
const percent = (value: number) => `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
export function GutEditor({ activities, onChange, disabled }: { activities: GutActivity[]; onChange: (items: GutActivity[]) => void; disabled: boolean }) {
  const ranked = rankGut(activities);
  const complete = activities.filter((item) => gutScore(item) !== null).length;
  function patch(id: string, update: Partial<GutActivity>) {
    onChange(activities.map((item) => item.id === id ? { ...item, ...update } : item));
  }
  return <Stack>
    <Paper withBorder p="lg" radius="lg"><Stack>
      <Group justify="space-between"><div><Title order={3}>Atividades da operação</Title><Text size="sm" c="dimmed">Liste todas as atividades primeiro. Você pode preencher as notas depois e salvar para continuar em outro momento.</Text></div><Button disabled={disabled || activities.length >= 200} onClick={() => onChange([...activities, { id: crypto.randomUUID(), title: "Nova atividade", gravity: null, urgency: null, tendency: null }])}>Adicionar atividade</Button></Group>
      <Text size="sm">Avalie de 1 a 5: gravidade das consequências, urgência para agir e tendência de piora se nada for feito.</Text>
      {!activities.length ? <Text c="dimmed" py="lg">Adicione a primeira atividade para começar o mapeamento GUT.</Text> : <Table.ScrollContainer minWidth={950}><Table verticalSpacing="sm"><Table.Thead><Table.Tr><Table.Th>Atividade</Table.Th> {dimensions.map((field) => <Table.Th key={field.key}>{field.label}</Table.Th>)}<Table.Th /></Table.Tr></Table.Thead><Table.Tbody>{activities.map((item, index) => <Table.Tr key={item.id}>
        <Table.Td><TextInput aria-label={`Atividade ${index + 1}`} value={item.title} maxLength={300} disabled={disabled} onChange={(event) => patch(item.id, { title: event.currentTarget.value })} /></Table.Td>
        {dimensions.map((field) => <Table.Td key={field.key}><Select aria-label={`${field.label} de ${item.title}`} placeholder="Avaliar depois" clearable disabled={disabled} value={item[field.key] === null ? null : String(item[field.key])} data={field.guide.split("|").map((label, i) => ({ value: String(i + 1), label }))} onChange={(value) => patch(item.id, { [field.key]: value ? Number(value) : null })} /></Table.Td>)}
        <Table.Td><Button size="xs" color="red" variant="subtle" disabled={disabled} aria-label={`Excluir ${item.title}`} onClick={() => { if (window.confirm(`Excluir a atividade “${item.title}”?`)) onChange(activities.filter((row) => row.id !== item.id)); }}>Excluir</Button></Table.Td>
      </Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>}
    </Stack></Paper>
    <Paper withBorder p="lg" radius="lg"><Stack>
      <Group justify="space-between"><Title order={3}>Prioridades por impacto</Title><Badge>{complete}/{activities.length} avaliadas</Badge></Group>
      <Text size="sm" c="dimmed">Ordem automática do maior para o menor: G × U × T, até 125 pontos. Impacto = pontos ÷ 125 × 100. Cada atividade tem seu próprio percentual; os percentuais não são somados. Atividades sem as três notas ficam pendentes no final.</Text>
      {ranked.length > 0 && <Table.ScrollContainer minWidth={600}><Table verticalSpacing="sm"><Table.Thead><Table.Tr><Table.Th>Ordem</Table.Th><Table.Th>Atividade</Table.Th><Table.Th>G × U × T</Table.Th><Table.Th>Impacto</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{ranked.map((item, index) => {
        const impact = gutImpact(item); const score = gutScore(item);
        return <Table.Tr key={item.id}><Table.Td>{score === null ? "—" : index + 1}</Table.Td><Table.Td><Text size="sm" style={{ overflowWrap: "anywhere" }}>{item.title || "Atividade sem nome"}</Text></Table.Td><Table.Td>{score === null ? "—" : `${item.gravity} × ${item.urgency} × ${item.tendency} = ${score}`}</Table.Td><Table.Td>{impact === null ? <Badge color="gray">Pendente</Badge> : <Stack gap={4}><Text size="sm" fw={700}>{percent(impact)}</Text><Progress value={impact} aria-label={`Impacto de ${item.title}: ${percent(impact)}`} /></Stack>}</Table.Td></Table.Tr>;
      })}</Table.Tbody></Table></Table.ScrollContainer>}
    </Stack></Paper>
  </Stack>;
}
