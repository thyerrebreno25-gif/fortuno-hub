"use client";
import { useRef, useState } from "react";
import { Alert, Badge, Button, Checkbox, Group, NumberInput, Paper, Select, Stack, Text, Textarea, TextInput } from "@mantine/core";
import { IconPlus, IconArrowRight, IconTrash, IconLayoutGrid } from "@tabler/icons-react";
import { newNode, removeNode, validationIssues, type FlowGraph, type FlowNode } from "./model";
import styles from "./mapping.module.css";

const kinds = [{ value: "start", label: "Início" }, { value: "step", label: "Etapa" }, { value: "decision", label: "Decisão" }, { value: "end", label: "Fim" }];
export function FlowEditor({ graph, onChange, disabled = false }: { graph: FlowGraph; onChange: (graph: FlowGraph) => void; disabled?: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  const drag = useRef<{ id: string; px: number; py: number; x: number; y: number } | null>(null);
  const node = graph.nodes.find((item) => item.id === selected);
  const issues = validationIssues(graph);
  const width = Math.max(1100, ...graph.nodes.map((item) => item.x + 300));
  const height = Math.max(620, ...graph.nodes.map((item) => item.y + 200));
  const options = graph.nodes.map((item, index) => ({ value: item.id, label: `${index + 1}. ${item.title}` }));
  function patchNode(patch: Partial<FlowNode>, invalidate = true) {
    if (!node || disabled) return;
    onChange({ ...graph, nodes: graph.nodes.map((item) => item.id === node.id ? { ...item, ...patch, ...(invalidate ? { validated: false } : {}) } : item) });
  }
  function topology(next: FlowGraph) { onChange({ ...next, nodes: next.nodes.map((item) => ({ ...item, validated: false })) }); }
  function connect(to = target) {
    if (disabled || !source || !to) return;
    if (source === to || graph.edges.some((edge) => edge.source === source && edge.target === to && edge.label === label)) { setError("Escolha etapas diferentes e uma conexão que ainda não exista."); return; }
    if (graph.edges.length >= 250) { setError("Limite de 250 conexões atingido."); return; }
    topology({ ...graph, edges: [...graph.edges, { id: crypto.randomUUID(), source, target: to, label }] });
    setSource(null); setTarget(null); setLabel(""); setError("");
  }
  return <Stack gap="sm">
    <Group justify="space-between">
      <Group gap="xs">{kinds.map((kind) => <Button key={kind.value} size="xs" variant="light" leftSection={<IconPlus size={14} />} disabled={disabled || graph.nodes.length >= 100} onClick={() => {
        const next = newNode(kind.value as FlowNode["type"], graph.nodes.length);
        if (graph.nodes.length) { next.x = 70; next.y = Math.min(10000, Math.max(...graph.nodes.map((item) => item.y)) + 190); }
        topology({ ...graph, nodes: [...graph.nodes, next] }); setSelected(next.id);
      }}>{kind.label}</Button>)}</Group>
      <Button size="xs" variant="default" leftSection={<IconLayoutGrid size={14} />} disabled={disabled || !graph.nodes.length} onClick={() => onChange({ ...graph, nodes: graph.nodes.map((item, index) => ({ ...item, x: 70 + index % 3 * 300, y: 60 + Math.floor(index / 3) * 190 })) })}>Organizar posições</Button>
    </Group>
    <Text size="xs" c="dimmed">Arraste pelo título das caixas. Selecione uma etapa para editar. Para conectar, clique no ponto de saída e depois no ponto de entrada de outra caixa. Use as setas do teclado no título para mover a caixa selecionada.</Text>
    {source && <Alert color="blue">Conectando a partir de “{graph.nodes.find((item) => item.id === source)?.title}”. Escolha a entrada de outra caixa ou <Button size="compact-xs" variant="subtle" onClick={() => setSource(null)}>cancelar</Button>.</Alert>}
    {error && <Alert color="orange" withCloseButton onClose={() => setError("")}>{error}</Alert>}
    <div className={styles.editorLayout}>
      <div className={styles.viewport}>
        <div className={styles.canvas} style={{ width, height }}>
          <svg width={width} height={height} className={styles.connections} aria-label="Conexões do processo">
            <defs><marker id="mapping-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#7890ac" /></marker></defs>
            {graph.edges.map((edge) => {
              const a = graph.nodes.find((item) => item.id === edge.source); const b = graph.nodes.find((item) => item.id === edge.target);
              if (!a || !b) return null;
              const x1 = a.x + 220, y1 = a.y + 65, x2 = b.x, y2 = b.y + 65;
              const bend = Math.max(60, Math.abs(x2 - x1) / 2);
              return <g key={edge.id}><path d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`} fill="none" stroke="#7890ac" strokeWidth={2} markerEnd="url(#mapping-arrow)" />{edge.label && <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 8} textAnchor="middle" className={styles.edgeLabel}><title>{edge.label}</title>{edge.label.length > 12 ? `${edge.label.slice(0, 12)}…` : edge.label}</text>}</g>;
            })}
          </svg>
          {!graph.nodes.length && <div className={styles.canvasEmpty}><Text fw={700}>Seu processo começa aqui</Text><Text size="sm" c="dimmed">Adicione uma etapa ou organize a descrição com IA na aba de criação.</Text></div>}
          {graph.nodes.map((item, index) => <div key={item.id} className={`${styles.node} ${selected === item.id ? styles.selected : ""}`} data-kind={item.type} style={{ left: item.x, top: item.y }}>
            <button className={styles.portIn} aria-label={`Conectar entrada de ${item.title}`} disabled={disabled || !source} onClick={() => connect(item.id)} />
            <button className={styles.nodeHeading} aria-label={`Mover ou editar ${item.title}`} onClick={() => setSelected(item.id)}
              onPointerDown={(event) => { if (disabled || event.button !== 0) return; setSelected(item.id); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { id: item.id, px: event.clientX, py: event.clientY, x: item.x, y: item.y }; }}
              onPointerMove={(event) => { const current = drag.current; if (!current || current.id !== item.id || disabled) return; onChange({ ...graph, nodes: graph.nodes.map((row) => row.id === item.id ? { ...row, x: Math.max(0, Math.min(10000, current.x + event.clientX - current.px)), y: Math.max(0, Math.min(10000, current.y + event.clientY - current.py)) } : row) }); }}
              onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
              onKeyDown={(event) => { if (disabled || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return; event.preventDefault(); onChange({ ...graph, nodes: graph.nodes.map((row) => row.id === item.id ? { ...row, x: Math.max(0, Math.min(10000, row.x + (event.key === "ArrowRight" ? 20 : event.key === "ArrowLeft" ? -20 : 0))), y: Math.max(0, Math.min(10000, row.y + (event.key === "ArrowDown" ? 20 : event.key === "ArrowUp" ? -20 : 0))) } : row) }); }}>
              <span>{String(index + 1).padStart(2, "0")} · {kinds.find((kind) => kind.value === item.type)?.label}</span><strong>{item.title}</strong>
            </button>
            <button className={styles.nodeDetails} onClick={() => setSelected(item.id)}><span>{item.owner || "Responsável a definir"}</span><Badge size="xs" variant="light" color={item.validated ? "green" : "orange"}>{item.validated ? "Validada" : "Revisar"}</Badge></button>
            <button className={styles.portOut} aria-label={`Conectar saída de ${item.title}`} disabled={disabled} onClick={() => { setSource(item.id); setTarget(null); }} />
          </div>)}
        </div>
      </div>
      <Paper withBorder radius="lg" p="md" className={styles.inspector}>
        {node ? <Stack gap="sm"><Group justify="space-between"><Text fw={800}>Detalhes da etapa</Text><Badge>{graph.nodes.indexOf(node) + 1}</Badge></Group>
          <TextInput label="Nome da etapa" value={node.title} maxLength={160} disabled={disabled} onChange={(e) => patchNode({ title: e.currentTarget.value })} />
          <Select label="Tipo" data={kinds} value={node.type} disabled={disabled} onChange={(value) => patchNode({ type: (value || "step") as FlowNode["type"] })} />
          <Textarea label="O que acontece aqui?" value={node.description} autosize minRows={2} maxLength={3000} disabled={disabled} onChange={(e) => patchNode({ description: e.currentTarget.value })} />
          {([{ key: "owner", label: "Responsável / área", max: 200 }, { key: "tools", label: "Ferramentas e sistemas", max: 500 }, { key: "input", label: "Entradas", max: 1000 }, { key: "output", label: "Saídas / entregáveis", max: 1000 }, { key: "pain", label: "Gargalos e pontos de atenção", max: 2000 }] as const).map((field) => <TextInput key={field.key} label={field.label} value={node[field.key]} maxLength={field.max} disabled={disabled} onChange={(e) => patchNode({ [field.key]: e.currentTarget.value })} />)}
          <Group grow><NumberInput label="Posição X" min={0} max={10000} value={node.x} disabled={disabled} onChange={(value) => patchNode({ x: Number(value) || 0 }, false)} /><NumberInput label="Posição Y" min={0} max={10000} value={node.y} disabled={disabled} onChange={(value) => patchNode({ y: Number(value) || 0 }, false)} /></Group>
          <Checkbox label="Revisei e validei esta etapa" checked={node.validated} disabled={disabled || !node.title.trim()} onChange={(e) => patchNode({ validated: e.currentTarget.checked }, false)} />
          <Button color="red" variant="subtle" size="xs" leftSection={<IconTrash size={14} />} disabled={disabled} onClick={() => { if (window.confirm("Excluir esta etapa e suas conexões?")) { topology(removeNode(graph, node.id)); setSelected(null); } }}>Excluir etapa</Button>
        </Stack> : <Stack><Text fw={800}>Detalhes da etapa</Text><Text size="sm" c="dimmed">Clique em uma caixa para revisar responsáveis, entradas, saídas e pontos de atenção.</Text></Stack>}
      </Paper>
    </div>
    <Paper withBorder radius="lg" p="md"><Stack gap="sm"><Text fw={800}>Conexões e condições</Text>
      <Group align="end"><Select label="De" placeholder="Etapa de origem" data={options} value={source} onChange={setSource} disabled={disabled} searchable /><Select label="Para" placeholder="Etapa de destino" data={options.filter((option) => option.value !== source)} value={target} onChange={setTarget} disabled={disabled} searchable /><TextInput label="Condição / rótulo" placeholder="Ex.: Sim, Não, Aprovado" value={label} maxLength={120} onChange={(e) => setLabel(e.currentTarget.value)} disabled={disabled} /><Button leftSection={<IconArrowRight size={15} />} disabled={disabled || !source || !target} onClick={() => connect()}>Conectar</Button></Group>
      {graph.edges.map((edge) => <Group key={edge.id} wrap="nowrap"><Text size="sm" style={{ flex: 1 }}>{graph.nodes.find((item) => item.id === edge.source)?.title} → {graph.nodes.find((item) => item.id === edge.target)?.title}</Text><TextInput aria-label="Rótulo da conexão" value={edge.label} maxLength={120} disabled={disabled} onChange={(event) => topology({ ...graph, edges: graph.edges.map((item) => item.id === edge.id ? { ...item, label: event.currentTarget.value } : item) })} /><Button variant="subtle" color="red" size="compact-xs" disabled={disabled} aria-label="Remover conexão" onClick={() => topology({ ...graph, edges: graph.edges.filter((item) => item.id !== edge.id) })}>Remover</Button></Group>)}
    </Stack></Paper>
    {graph.nodes.length > 0 && issues.length > 0 && <Alert color="orange" title="Pontos para revisar"><ul>{issues.slice(0, 12).map((issue, index) => <li key={index}>{issue}</li>)}</ul></Alert>}
  </Stack>;
}
