"use client";
import { Autocomplete, Badge, Button, Group, Paper, Stack, Table, Text, Textarea, TextInput } from "@mantine/core";
import { newNode, removeNode, type FlowGraph, type FlowNode } from "./model";
import { appendGuided, areas, operations } from "./guided-model";

export function GuidedEditor({ graph, onChange, disabled }: { graph: FlowGraph; onChange: (graph: FlowGraph) => void; disabled: boolean }) {
  function update(id: string, patch: Partial<FlowNode>) {
    onChange({ ...graph, nodes: graph.nodes.map((node) => node.id === id ? { ...node, ...patch, validated: false } : node) });
  }
  function add(id: string, action: "next" | "branch" | "end") { onChange(appendGuided(graph, id, action)); }
  return <Paper withBorder radius="lg" p="lg"><Stack>
    <div><Text fw={800}>Monte o processo, uma linha por vez</Text><Text size="sm" c="dimmed">Comece pelo início, escolha uma operação ou escreva a sua. Depois indique se o próximo passo tem um ou mais caminhos. As caixas e setas são criadas automaticamente no editor manual.</Text></div>
    {!graph.nodes.length ? <Button disabled={disabled} onClick={() => onChange({ nodes: [newNode("start", 0)], edges: [] })}>Começar pelo INÍCIO</Button> : <Table.ScrollContainer minWidth={1000}><Table verticalSpacing="md" withRowBorders>
      <Table.Thead><Table.Tr><Table.Th>Etapa / operação</Table.Th><Table.Th>Quem faz?</Table.Th><Table.Th>Sistema / entrega</Table.Th><Table.Th>Próximo passo / caminhos</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>{graph.nodes.map((node, index) => {
        const outgoing = graph.edges.filter((edge) => edge.source === node.id);
        const incoming = graph.edges.filter((edge) => edge.target === node.id);
        return <Table.Tr key={node.id} style={{ verticalAlign: "top" }}>
          <Table.Td style={{ minWidth: 265 }}><Stack gap="xs"><Group><Badge variant="light">{index + 1} · {{ start: "Início", step: "Operação", decision: "Decisão", end: "Fim" }[node.type]}</Badge><Button variant="subtle" color="red" size="compact-xs" disabled={disabled} aria-label={`Excluir etapa ${index + 1}`} onClick={() => { if (window.confirm("Excluir esta etapa e suas setas? As outras etapas serão mantidas.")) onChange({ ...removeNode(graph, node.id), nodes: removeNode(graph, node.id).nodes.map((item) => ({ ...item, validated: false })) }); }}>Excluir</Button></Group>
            {incoming.map((edge) => <Text key={edge.id} size="xs" c="dimmed">Vem de {graph.nodes.findIndex((item) => item.id === edge.source) + 1}{edge.label ? ` · ${edge.label}` : ""}</Text>)}
            <Autocomplete aria-label={`Operação da etapa ${index + 1}`} data={operations} filter={({ options }) => options} onFocus={(event) => event.currentTarget.select()} placeholder="Escolha ou digite a operação" value={node.title} maxLength={160} disabled={disabled} onChange={(title) => update(node.id, { title })} />
            <Textarea aria-label={`Descrição da etapa ${index + 1}`} placeholder={node.type === "start" ? "O que inicia este processo?" : node.type === "decision" ? "Qual pergunta define os caminhos?" : "O que é feito nesta etapa?"} value={node.description} maxLength={3000} autosize minRows={2} disabled={disabled} onChange={(event) => update(node.id, { description: event.currentTarget.value })} />
          </Stack></Table.Td>
          <Table.Td style={{ minWidth: 175 }}><Autocomplete aria-label={`Responsável da etapa ${index + 1}`} data={areas} placeholder="Pessoa ou área" value={node.owner} maxLength={200} disabled={disabled} onChange={(owner) => update(node.id, { owner })} /></Table.Td>
          <Table.Td style={{ minWidth: 195 }}><Stack gap="xs"><TextInput aria-label={`Sistema da etapa ${index + 1}`} placeholder="Sistema / ferramenta" value={node.tools} maxLength={500} disabled={disabled} onChange={(event) => update(node.id, { tools: event.currentTarget.value })} /><TextInput aria-label={`Entrega da etapa ${index + 1}`} placeholder="Saída / entrega" value={node.output} maxLength={1000} disabled={disabled} onChange={(event) => update(node.id, { output: event.currentTarget.value })} /></Stack></Table.Td>
          <Table.Td style={{ minWidth: 290 }}><Stack gap="xs">
            {outgoing.map((edge) => <Group key={edge.id} wrap="nowrap"><TextInput aria-label={`Condição de ${index + 1} para ${graph.nodes.findIndex((item) => item.id === edge.target) + 1}`} placeholder="Condição (opcional)" value={edge.label} maxLength={120} disabled={disabled} onChange={(event) => onChange({ nodes: graph.nodes.map((item) => ({ ...item, validated: false })), edges: graph.edges.map((item) => item.id === edge.id ? { ...item, label: event.currentTarget.value } : item) })} /><Text size="xs">→ {graph.nodes.findIndex((item) => item.id === edge.target) + 1}. {graph.nodes.find((item) => item.id === edge.target)?.title}</Text></Group>)}
            {node.type === "end" ? <Text size="sm" c="dimmed">Este caminho termina aqui.</Text> : <>
              {!outgoing.length && <Text size="xs" fw={700}>O próximo passo possui mais de um caminho?</Text>}
              <Group gap="xs"><Button size="xs" variant="light" disabled={disabled || graph.nodes.length + (outgoing.length && node.type !== "decision" ? 2 : 1) > 100 || graph.edges.length > 247} onClick={() => add(node.id, "next")}>{outgoing.length ? "Adicionar caminho" : "Não · próximo passo"}</Button>{!outgoing.length && <Button size="xs" variant="light" color="orange" disabled={disabled || graph.nodes.length > 97 || graph.edges.length > 247} onClick={() => add(node.id, "branch")}>Sim · dividir caminhos</Button>}<Button size="xs" variant="subtle" color="grape" disabled={disabled || graph.nodes.length + (outgoing.length && node.type !== "decision" ? 2 : 1) > 100 || graph.edges.length > 247} onClick={() => add(node.id, "end")}>Encerrar com FIM</Button></Group>
            </>}
          </Stack></Table.Td>
        </Table.Tr>;
      })}</Table.Tbody>
    </Table></Table.ScrollContainer>}
  </Stack></Paper>;
}
