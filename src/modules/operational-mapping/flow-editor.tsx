"use client";
import { useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Checkbox, Group, Modal, NumberInput, Paper, Select, Stack, Text, Textarea, TextInput } from "@mantine/core";
import { IconPlus, IconTrash, IconLayoutGrid } from "@tabler/icons-react";
import { newNode, removeNode, validationIssues, type FlowGraph, type FlowNode } from "./model";
import { connectionPath, defaultSides, portPoint, portSides, type PortSide } from "./connections";
import { duplicateStep, scaledDelta } from "./editor-actions";
import styles from "./mapping.module.css";

const kinds = [{ value: "start", label: "Início" }, { value: "step", label: "Etapa" }, { value: "decision", label: "Decisão" }, { value: "end", label: "Fim" }];
export function FlowEditor({ graph, onChange, disabled = false }: { graph: FlowGraph; onChange: (graph: FlowGraph) => void; disabled?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [zoom, setZoom] = useState(1);
  const clipboard = useRef<FlowNode | null>(null);
  const pasteCount = useRef(0);
  const editor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [expanded]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const movedNode = useRef(false);
  const descriptionInput = useRef<HTMLTextAreaElement>(null);
  const details = graph.nodes.find((item) => item.id === detailsId);
  function openDetails(id: string) { setSelected(id); setSelectedEdge(null); setDetailsId(id); }
  const [source, setSource] = useState<string | null>(null);
  const [sourceSide, setSourceSide] = useState<PortSide>("right");
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ x: number; y: number } | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const linking = useRef<{ id: string; side: PortSide; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const [error, setError] = useState("");
  const drag = useRef<{ id: string; px: number; py: number; x: number; y: number } | null>(null);
  const node = graph.nodes.find((item) => item.id === selected);
  const issues = validationIssues(graph);
  const width = Math.max(1100, ...graph.nodes.map((item) => item.x + 550));
  const height = Math.max(620, ...graph.nodes.map((item) => item.y + 460));
  const edge = graph.edges.find((item) => item.id === selectedEdge);
  function patchNode(patch: Partial<FlowNode>, invalidate = true) {
    if (!node || disabled) return;
    onChange({ ...graph, nodes: graph.nodes.map((item) => item.id === node.id ? { ...item, ...patch, ...(invalidate ? { validated: false } : {}) } : item) });
  }
  function topology(next: FlowGraph) { onChange({ ...next, nodes: next.nodes.map((item) => ({ ...item, validated: false })) }); }
  function connect(to: string, from = source, fromSide = sourceSide, toSide?: PortSide) {
    if (disabled || !from) return;
    const a = graph.nodes.find((item) => item.id === from)!;
    const b = graph.nodes.find((item) => item.id === to)!;
    const destinationSide = toSide || defaultSides(a, b)[1];
    if (from === to || graph.edges.some((edge) => edge.source === from && edge.target === to && (edge.sourceSide || defaultSides(a, b)[0]) === fromSide && (edge.targetSide || defaultSides(a, b)[1]) === destinationSide)) { setError("Escolha etapas diferentes e uma conexão que ainda não exista."); return; }
    if (graph.edges.length >= 250) { setError("Limite de 250 conexões atingido."); return; }
    const id = crypto.randomUUID();
    topology({ ...graph, edges: [...graph.edges, { id, source: from, target: to, sourceSide: fromSide, targetSide: destinationSide, label: "" }] });
    setSelectedEdge(id); setSelected(null); setSource(null); setError("");
  }
  function deleteSelection() {
    if (disabled || (!node && !edge)) return;
    if (!window.confirm(node ? "Excluir esta etapa e suas conexões?" : "Excluir esta conexão?")) return;
    topology(node ? removeNode(graph, node.id) : { ...graph, edges: graph.edges.filter((item) => item.id !== edge!.id) });
    setSelected(null); setSelectedEdge(null); setSource(null); setPreview(null);
    editor.current?.focus();
  }
  function pasteStep() {
    if (disabled || !clipboard.current) return;
    if (graph.nodes.length >= 100) { setError("Limite de 100 etapas atingido."); return; }
    const next = duplicateStep(clipboard.current, crypto.randomUUID(), 40 * (++pasteCount.current));
    topology({ ...graph, nodes: [...graph.nodes, next] });
    setSelected(next.id); setSelectedEdge(null); setError("");
    editor.current?.focus();
  }
  return <Stack ref={editor} tabIndex={-1} className={expanded ? styles.expandedEditor : undefined} gap="sm" onKeyDown={(event) => {
    if (details || event.nativeEvent.isComposing) return;
    if (event.key === "Escape") { setExpanded(false); setSource(null); setPreview(null); return; }
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"], [role="dialog"]')) return;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === "c" && node) { event.preventDefault(); clipboard.current = { ...node }; pasteCount.current = 0; }
    if ((event.ctrlKey || event.metaKey) && key === "v" && clipboard.current && !disabled) { event.preventDefault(); if (!event.repeat) pasteStep(); }
    if (event.key === "Delete" && !disabled && (node || edge)) { event.preventDefault(); if (!event.repeat) deleteSelection(); }
  }}>
    <Group justify="space-between">
      <Group gap="xs"><Button size="xs" variant="default" aria-label="Diminuir zoom" disabled={zoom <= 0.4} onClick={() => setZoom((value) => Math.max(0.4, Number((value - 0.1).toFixed(1))))}>−</Button><Button size="xs" variant="subtle" aria-label="Restaurar zoom para 100%" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</Button><Button size="xs" variant="default" aria-label="Aumentar zoom" disabled={zoom >= 2} onClick={() => setZoom((value) => Math.min(2, Number((value + 0.1).toFixed(1))))}>+</Button>
      <Button size="xs" variant="light" disabled={disabled || !node || graph.nodes.length >= 100} onClick={() => { if (node) { clipboard.current = { ...node }; pasteCount.current = 0; pasteStep(); } }}>Duplicar etapa</Button><Button size="xs" color="red" variant="light" disabled={disabled || (!node && !edge)} onClick={deleteSelection}>Excluir seleção</Button></Group>
      <Button size="xs" variant="light" onClick={() => setExpanded((value) => !value)}>{expanded ? "Voltar ao tamanho normal" : "Ampliar editor"}</Button>
    </Group>
    <Modal opened={Boolean(details)} onClose={() => setDetailsId(null)} title={details?.title || "Detalhes da etapa"} size="lg" centered zIndex={400}>
      {details && <Stack gap="md">
        <Group gap="xs"><Badge variant="light">{kinds.find((kind) => kind.value === details.type)?.label}</Badge><Badge color={details.validated ? "green" : "orange"}>{details.validated ? "Validada" : "Revisar"}</Badge></Group>
        <div><Text fw={700} size="sm" mb={6}>Descritivo / instruções</Text><Text size="sm" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }} c={details.description.trim() ? undefined : "dimmed"}>{details.description.trim() ? details.description : "Esta etapa ainda não tem um descritivo. Preencha as instruções no painel de edição para consultá-las aqui."}</Text></div>
        {([{ key: "owner", label: "Responsável / área" }, { key: "tools", label: "Ferramentas e sistemas" }, { key: "input", label: "Entradas" }, { key: "output", label: "Saídas / entregáveis" }, { key: "pain", label: "Pontos de atenção" }] as const).filter((field) => details[field.key].trim()).map((field) => <div key={field.key}><Text fw={700} size="sm" mb={4}>{field.label}</Text><Text size="sm" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{details[field.key]}</Text></div>)}
        <Group justify="flex-end"><Button variant="default" onClick={() => setDetailsId(null)}>Fechar</Button>{!disabled && <Button onClick={() => { setDetailsId(null); window.setTimeout(() => { descriptionInput.current?.scrollIntoView({ behavior: "smooth", block: "center" }); descriptionInput.current?.focus(); }, 200); }}>Editar informações</Button>}</Group>
      </Stack>}
    </Modal>
    <Group justify="space-between">
      <Group gap="xs"><Button size="xs" variant="subtle" disabled={!source} onClick={() => { setSource(null); setPreview(null); }}>Cancelar conexão</Button>{kinds.map((kind) => <Button key={kind.value} size="xs" variant="light" leftSection={<IconPlus size={14} />} disabled={disabled || graph.nodes.length >= 100} onClick={() => {
        const next = newNode(kind.value as FlowNode["type"], graph.nodes.length);
        if (graph.nodes.length) { next.x = 70; next.y = Math.min(10000, Math.max(...graph.nodes.map((item) => item.y)) + 190); }
        topology({ ...graph, nodes: [...graph.nodes, next] }); setSelected(next.id);
      }}>{kind.label}</Button>)}</Group>
      <Button size="xs" variant="default" leftSection={<IconLayoutGrid size={14} />} disabled={disabled || !graph.nodes.length} onClick={() => onChange({ ...graph, nodes: graph.nodes.map((item, index) => ({ ...item, x: 70 + index % 3 * 300, y: 60 + Math.floor(index / 3) * 190 })) })}>Organizar posições</Button>
    </Group>
    <Text size="xs" c="dimmed">Clique no título para selecionar e arraste para mover. Consulte o descritivo clicando na parte inferior da caixa ou com dois cliques no título. Delete exclui a seleção; Ctrl+C e Ctrl+V copiam e colam a etapa. Esc sai do modo ampliado. Use o painel lateral para editar. Para conectar, arraste qualquer ponto azul até o ponto desejado de outra caixa. Para retornar, use os pontos inferiores ou superiores para separar a volta da ida. Clique na seta para editar sua condição (opcional). Você também pode clicar na saída e depois na entrada. Use as setas do teclado no título para mover a caixa selecionada.</Text>
    {error && <Alert color="orange" withCloseButton onClose={() => setError("")}>{error}</Alert>}
    <div className={styles.editorLayout}>
      <div className={styles.viewport} tabIndex={0} aria-label="Área do diagrama" onPointerDown={(event) => { if (event.target === event.currentTarget || event.target === canvas.current) event.currentTarget.focus(); }}>
        <div style={{ width: width * zoom, height: height * zoom, position: "relative", overflow: "hidden" }}>
        <div ref={canvas} className={styles.canvas} style={{ width, height, transform: `scale(${zoom})`, transformOrigin: "top left" }}>
          <svg width={width} height={height} className={styles.connections} aria-label="Conexões do processo">
            <defs><marker id="mapping-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#7890ac" /></marker></defs>
            {graph.edges.map((edge) => {
              const a = graph.nodes.find((item) => item.id === edge.source); const b = graph.nodes.find((item) => item.id === edge.target);
              if (!a || !b) return null;
              const route = connectionPath(a, b, edge);
              return <g key={edge.id} role="button" tabIndex={0} aria-label={`Editar conexão de ${a.title} para ${b.title}`} style={{ cursor: "pointer", pointerEvents: "auto" }} onClick={() => { setSelectedEdge(edge.id); setSelected(null); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedEdge(edge.id); setSelected(null); } }}><path d={route.d} fill="none" stroke="transparent" strokeWidth={18} /><path d={route.d} fill="none" stroke={selectedEdge === edge.id ? "#228be6" : "#7890ac"} strokeWidth={selectedEdge === edge.id ? 3 : 2} markerEnd="url(#mapping-arrow)" />{edge.label && <text x={route.label.x} y={route.label.y} textAnchor="middle" className={styles.edgeLabel}><title>{edge.label}</title>{edge.label.length > 12 ? `${edge.label.slice(0, 12)}…` : edge.label}</text>}</g>;
            })}
            {source && preview && (() => { const from = graph.nodes.find((item) => item.id === source); const point = from ? portPoint(from, sourceSide) : null; return point ? <path d={`M ${point.x} ${point.y} L ${preview.x} ${preview.y}`} stroke="#228be6" strokeWidth={2} strokeDasharray="6 4" fill="none" /> : null; })()}
          </svg>
          {!graph.nodes.length && <div className={styles.canvasEmpty}><Text fw={700}>Seu processo começa aqui</Text><Text size="sm" c="dimmed">Adicione uma caixa acima ou monte a sequência na aba Criação guiada.</Text></div>}
          {graph.nodes.map((item, index) => <div key={item.id} className={`${styles.node} ${selected === item.id ? styles.selected : ""}`} data-kind={item.type} data-flow-node={item.id} style={{ left: item.x, top: item.y }}>
            <button className={styles.nodeHeading} aria-label={`Selecionar ${item.title} ou arrastar para mover`} onDoubleClick={() => openDetails(item.id)} onClick={() => { if (movedNode.current) { movedNode.current = false; return; } setSelected(item.id); setSelectedEdge(null); }}
              onPointerDown={(event) => { movedNode.current = false; if (disabled || event.button !== 0) return; setSelected(item.id); setSelectedEdge(null); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { id: item.id, px: event.clientX, py: event.clientY, x: item.x, y: item.y }; }}
              onPointerMove={(event) => { const current = drag.current; if (!current || current.id !== item.id || disabled) return; if (Math.hypot(event.clientX - current.px, event.clientY - current.py) <= 4 && !movedNode.current) return; movedNode.current = true; onChange({ ...graph, nodes: graph.nodes.map((row) => row.id === item.id ? { ...row, x: Math.max(0, Math.min(10000, current.x + scaledDelta(event.clientX - current.px, zoom))), y: Math.max(0, Math.min(10000, current.y + scaledDelta(event.clientY - current.py, zoom))) } : row) }); }}
              onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; movedNode.current = true; }}
              onKeyDown={(event) => { if (disabled || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return; event.preventDefault(); onChange({ ...graph, nodes: graph.nodes.map((row) => row.id === item.id ? { ...row, x: Math.max(0, Math.min(10000, row.x + (event.key === "ArrowRight" ? 20 : event.key === "ArrowLeft" ? -20 : 0))), y: Math.max(0, Math.min(10000, row.y + (event.key === "ArrowDown" ? 20 : event.key === "ArrowUp" ? -20 : 0))) } : row) }); }}>
              <span>{String(index + 1).padStart(2, "0")} · {kinds.find((kind) => kind.value === item.type)?.label}</span><strong>{item.title}</strong>
            </button>
            <button className={styles.nodeDetails} aria-label={`Consultar descritivo de ${item.title}`} onClick={() => openDetails(item.id)}><span>{item.owner || "Responsável a definir"}</span><Badge size="xs" variant="light" color={item.validated ? "green" : "orange"}>{item.validated ? "Validada" : "Revisar"}</Badge></button>
            {portSides.map((side) => <button key={side.value} data-port-side={side.value} className={styles.port} aria-label={`Conectar ${side.label.toLowerCase()} de ${item.title}`} disabled={disabled} onPointerDown={(event) => { if (disabled || event.button !== 0) return; event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); linking.current = { id: item.id, side: side.value, x: event.clientX, y: event.clientY }; if (!source) { setSource(item.id); setSourceSide(side.value); } setPreview(null); suppressClick.current = false; }}
              onPointerMove={(event) => { if (!linking.current || disabled) return; const bounds = canvas.current?.getBoundingClientRect(); if (bounds) setPreview({ x: scaledDelta(event.clientX - bounds.left, zoom), y: scaledDelta(event.clientY - bounds.top, zoom) }); }}
              onPointerUp={(event) => { const current = linking.current; linking.current = null; setPreview(null); if (!current) return; const moved = Math.hypot(event.clientX - current.x, event.clientY - current.y) > 4; suppressClick.current = moved; if (!moved) return; const hit = document.elementFromPoint(event.clientX, event.clientY); const destination = hit?.closest<HTMLElement>("[data-flow-node]")?.dataset.flowNode; const side = hit?.closest<HTMLElement>("[data-port-side]")?.dataset.portSide as PortSide | undefined; setSource(null); if (destination) connect(destination, current.id, current.side, side); }}
              onPointerCancel={() => { linking.current = null; setPreview(null); setSource(null); suppressClick.current = true; }}
              onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } if (source && source !== item.id) connect(item.id, source, sourceSide, side.value); else { setSource(item.id); setSourceSide(side.value); } }} />)}
          </div>)}
        </div>
        </div>
      </div>
      <Paper withBorder radius="lg" p="md" className={styles.inspector}>
        {edge ? <Stack gap="sm"><Text fw={800}>Conexão selecionada</Text><Text size="sm">{graph.nodes.find((item) => item.id === edge.source)?.title} → {graph.nodes.find((item) => item.id === edge.target)?.title}</Text><TextInput label="Condição (opcional)" placeholder="Ex.: Sim, Não, Aprovado" value={edge.label} maxLength={120} disabled={disabled} onChange={(event) => topology({ ...graph, edges: graph.edges.map((item) => item.id === edge.id ? { ...item, label: event.currentTarget.value } : item) })} /><Group grow><Select label="Lado de saída" data={portSides} value={edge.sourceSide || defaultSides(graph.nodes.find((item) => item.id === edge.source)!, graph.nodes.find((item) => item.id === edge.target)!)[0]} disabled={disabled} onChange={(value) => onChange({ ...graph, edges: graph.edges.map((item) => item.id === edge.id ? { ...item, sourceSide: value as PortSide } : item) })} /><Select label="Lado de chegada" data={portSides} value={edge.targetSide || defaultSides(graph.nodes.find((item) => item.id === edge.source)!, graph.nodes.find((item) => item.id === edge.target)!)[1]} disabled={disabled} onChange={(value) => onChange({ ...graph, edges: graph.edges.map((item) => item.id === edge.id ? { ...item, targetSide: value as PortSide } : item) })} /></Group><NumberInput label="Afastamento da seta" description="Aumente para separar caminhos de retorno." min={25} max={300} value={edge.routeOffset ?? 50} disabled={disabled} onChange={(value) => onChange({ ...graph, edges: graph.edges.map((item) => item.id === edge.id ? { ...item, routeOffset: Math.max(25, Math.min(300, Number(value) || 50)) } : item) })} /><Text size="xs" c="dimmed">A seta já está criada. Preencha uma condição apenas quando precisar identificar o caminho.</Text><Button color="red" variant="light" disabled={disabled} onClick={() => { topology({ ...graph, edges: graph.edges.filter((item) => item.id !== edge.id) }); setSelectedEdge(null); }}>Remover conexão</Button></Stack> : node ? <Stack gap="sm"><Group justify="space-between"><Text fw={800}>Detalhes da etapa</Text><Badge>{graph.nodes.indexOf(node) + 1}</Badge></Group>
          <TextInput label="Nome da etapa" value={node.title} maxLength={160} disabled={disabled} onChange={(e) => patchNode({ title: e.currentTarget.value })} />
          <Select label="Tipo" data={kinds} value={node.type} disabled={disabled} onChange={(value) => patchNode({ type: (value || "step") as FlowNode["type"] })} />
          <Textarea ref={descriptionInput} label="Descritivo / instruções da etapa" description="Estas informações aparecem ao clicar na caixa." placeholder="Descreva o que fazer, como acessar o sistema e as orientações desta fase." value={node.description} autosize minRows={2} maxLength={3000} disabled={disabled} onChange={(e) => patchNode({ description: e.currentTarget.value })} />
          {([{ key: "owner", label: "Responsável / área", max: 200 }, { key: "tools", label: "Ferramentas e sistemas", max: 500 }, { key: "input", label: "Entradas", max: 1000 }, { key: "output", label: "Saídas / entregáveis", max: 1000 }, { key: "pain", label: "Gargalos e pontos de atenção", max: 2000 }] as const).map((field) => <TextInput key={field.key} label={field.label} value={node[field.key]} maxLength={field.max} disabled={disabled} onChange={(e) => patchNode({ [field.key]: e.currentTarget.value })} />)}
          <Group grow><NumberInput label="Posição X" min={0} max={10000} value={node.x} disabled={disabled} onChange={(value) => patchNode({ x: Number(value) || 0 }, false)} /><NumberInput label="Posição Y" min={0} max={10000} value={node.y} disabled={disabled} onChange={(value) => patchNode({ y: Number(value) || 0 }, false)} /></Group>
          <Checkbox label="Revisei e validei esta etapa" checked={node.validated} disabled={disabled || !node.title.trim()} onChange={(e) => patchNode({ validated: e.currentTarget.checked }, false)} />
          <Button color="red" variant="subtle" size="xs" leftSection={<IconTrash size={14} />} disabled={disabled} onClick={() => { if (window.confirm("Excluir esta etapa e suas conexões?")) { topology(removeNode(graph, node.id)); setSelected(null); } }}>Excluir etapa</Button>
        </Stack> : <Stack><Text fw={800}>Detalhes da etapa</Text><Text size="sm" c="dimmed">Clique em uma caixa para revisar responsáveis, entradas, saídas e pontos de atenção.</Text></Stack>}
      </Paper>
    </div>
    {graph.nodes.length > 0 && issues.length > 0 && <Alert color="orange" title="Pontos para revisar"><ul>{issues.slice(0, 12).map((issue, index) => <li key={index}>{issue}</li>)}</ul></Alert>}
  </Stack>;
}
