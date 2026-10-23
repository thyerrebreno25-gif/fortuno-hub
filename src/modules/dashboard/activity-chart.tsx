"use client";
import { useId, useState } from "react";
import { Group, Text } from "@mantine/core";
import type { DashboardUsageAnalytics } from "./types/dashboard.types";
export function ActivityChart({ timeline }: { timeline: DashboardUsageAnalytics["timeline"] }) {
  const id = useId().replace(/:/g, "");
  const [active, setActive] = useState<string | null>(null);
  const selected = timeline.find((item) => item.key === active) || timeline.at(-1);
  const maximum = Math.max(1, ...timeline.map((item) => item.total));
  const points = timeline.map((item, i) => ({ x: 50 + i * 800 / Math.max(1, timeline.length - 1), y: 210 - item.total / maximum * 170, item }));
  const path = points.map((point, i) => i === 0 ? `M ${point.x} ${point.y}` : `C ${(points[i-1].x + point.x)/2} ${points[i-1].y}, ${(points[i-1].x + point.x)/2} ${point.y}, ${point.x} ${point.y}`).join(" ");
  const date = (key: string) => key.length === 10 ? `${key.slice(8)}/${key.slice(5,7)}` : `${key.slice(5)}/${key.slice(0,4)}`;
  if (!timeline.length) return <Text c="dimmed">Sem atividades no período.</Text>;
  return <div>
    <svg viewBox="0 0 900 250" width="100%" style={{ display: "block", minHeight: 180 }} role="group" aria-label="Evolução de importações e envios. Selecione um ponto para consultar os valores.">
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#228be6" stopOpacity=".3"/><stop offset="100%" stopColor="#228be6" stopOpacity=".02"/></linearGradient></defs>
      {[0, .5, 1].map((fraction) => <g key={fraction}><line x1="50" x2="850" y1={210-fraction*170} y2={210-fraction*170} stroke="currentColor" opacity=".1"/><text x="40" y={215-fraction*170} textAnchor="end" fill="currentColor" fontSize="12">{Number((maximum*fraction).toFixed(1))}</text></g>)}
      <path d={`${path} L ${points.at(-1)!.x} 210 L 50 210 Z`} fill={`url(#${id})`}/><path d={path} fill="none" stroke="#228be6" strokeWidth="3"/>
      {points.map(({x,y,item}, index) => <g key={item.key}><circle cx={x} cy={y} r={item.key === selected?.key ? 6 : 4} fill="#228be6" tabIndex={0} role="button" aria-label={`${date(item.key)}: ${item.total} atividades`} onFocus={() => setActive(item.key)} onMouseEnter={() => setActive(item.key)} onClick={() => setActive(item.key)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setActive(item.key); } }}><title>{date(item.key)}: {item.total} atividades</title></circle>{(index === 0 || index === points.length-1 || index % Math.max(1, Math.ceil(points.length/6)) === 0) && <text x={x} y="238" textAnchor="middle" fill="currentColor" fontSize="12">{date(item.key)}</text>}</g>)}
    </svg>
    {selected && <Group justify="space-between" aria-live="polite"><Text size="sm" fw={700}>{date(selected.key)} · {selected.total} atividades</Text><Text size="sm" c="dimmed">{selected.imports} importações · {selected.caSends} envios ao Conta Azul</Text></Group>}
  </div>;
}
