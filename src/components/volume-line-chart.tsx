"use client";
import { useId, useState } from "react";
export type VolumePoint = {label: string; value: number};
/** A small shared chart for the monitoring and TV dashboards. Curves stay
 * between consecutive values, including zero; all values remain inspectable. */
export function VolumeLineChart({rows, label, color = "#248fdd", dark = false}: {rows: VolumePoint[]; label: string; color?: string; dark?: boolean}) {
  const id = useId().replace(/:/g, ""), [active, setActive] = useState<number | null>(null);
  if (!rows.length) return <p>Sem dados no período.</p>;
  const width = 720, height = 260, left = 45, right = 18, top = 18, bottom = 40;
  const max = Math.max(4, Math.ceil(Math.max(...rows.map(row => row.value)) / 4) * 4);
  const x = (index: number) => rows.length === 1 ? (width + left - right) / 2 : left + index * (width - left - right) / (rows.length - 1);
  const y = (value: number) => height - bottom - value / max * (height - bottom - top);
  let path = `M ${x(0)} ${y(rows[0].value)}`;
  for (let index = 1; index < rows.length; index++) {const mid = (x(index - 1) + x(index)) / 2; path += ` C ${mid} ${y(rows[index - 1].value)}, ${mid} ${y(rows[index].value)}, ${x(index)} ${y(rows[index].value)}`;}
  const ticks = rows.length <= 8 ? rows.map((_, index) => index) : [...new Set(Array.from({length: 7}, (_, index) => Math.round(index * (rows.length - 1) / 6)))];
  const text = dark ? "#a9c1d8" : "#6b809c", grid = dark ? "#284358" : "#e3ebf4";
  return <div style={{minWidth: 0, width: "100%"}}><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} style={{display: "block", width: "100%", maxHeight: 310, overflow: "visible"}}>
    <title>{label}</title><defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".20"/><stop offset="100%" stopColor={color} stopOpacity="0"/></linearGradient></defs>
    {[0, .25, .5, .75, 1].map(fraction => <g key={fraction}><line x1={left} x2={width - right} y1={y(max * fraction)} y2={y(max * fraction)} stroke={grid} strokeDasharray="3 7"/><text x={left - 12} y={y(max * fraction) + 4} textAnchor="end" fill={text} fontSize="11">{Math.round(max * fraction)}</text></g>)}
    <path d={`${path} L ${x(rows.length - 1)} ${y(0)} L ${x(0)} ${y(0)} Z`} fill={`url(#${id})`}/><path d={path} fill="none" stroke={color} strokeWidth="2.8" strokeLinejoin="round" strokeLinecap="round"/>
    {ticks.map(index => <text key={index} x={x(index)} y={height - 14} textAnchor={index === 0 ? "start" : index === rows.length - 1 ? "end" : "middle"} fill={text} fontSize="11">{rows[index].label}</text>)}
    {rows.map((row, index) => <g key={index}><circle cx={x(index)} cy={y(row.value)} r={active === index ? 5 : rows.length === 1 ? 4 : 0} fill={color}/><rect x={x(index) - (width - left - right) / Math.max(2, rows.length) / 2} y={top} width={(width - left - right) / Math.max(2, rows.length)} height={height - bottom - top} fill="transparent" tabIndex={0} aria-label={`${row.label}: ${row.value}`} onMouseEnter={() => setActive(index)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(index)} onBlur={() => setActive(null)}><title>{row.label}: {row.value}</title></rect></g>)}
  </svg><div aria-live="polite" style={{minHeight: 20, fontSize: 12, color: text, textAlign: "right"}}>{active === null ? "Passe sobre a linha para consultar os valores" : `${rows[active].label} · ${rows[active].value.toLocaleString("pt-BR")} conversas`}</div></div>;
}
