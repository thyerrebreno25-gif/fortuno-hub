"use client";
import { useEffect, useId, useRef, useState } from "react";
import styles from "./volume-line-chart.module.css";
export type VolumePoint = {label: string; value: number};
/** A small shared chart for the monitoring and TV dashboards. Curves stay
 * between consecutive values, including zero; all values remain inspectable. */
export function VolumeLineChart({rows, label, color = "#248fdd", dark = false, fill = false, unit = "conversas", maxValue}: {rows: VolumePoint[]; label: string; color?: string; dark?: boolean; fill?: boolean; unit?: string; maxValue?: number}) {
  const id = useId().replace(/:/g, ""), [active, setActive] = useState<number | null>(null);
  const plot = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({width: 720, height: 260});
  const hasRows = rows.length > 0;
  useEffect(() => {
    const element = plot.current;
    if (!hasRows || !element) return;
    // Match the drawing to the actual card, rather than shrinking a fixed SVG
    // into a short viewport and leaving most of the available width empty.
    const observer = new ResizeObserver(entries => {
      const bounds = entries[0]?.contentRect;
      if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;
      const width = Math.round(bounds.width), height = Math.round(bounds.height);
      setSize(previous => previous.width === width && previous.height === height ? previous : {width, height});
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasRows]);
  if (!rows.length) return <p>Sem dados no período.</p>;
  const {width, height} = size, fontSize = fill ? 16 : 13;
  const max = maxValue || Math.max(4, Math.ceil(Math.max(...rows.map(row => row.value)) / 4) * 4);
  const left = Math.max(50, String(max).length * fontSize * .65 + 18), right = 18, top = 16, bottom = fontSize + 22;
  const x = (index: number) => rows.length === 1 ? (width + left - right) / 2 : left + index * (width - left - right) / (rows.length - 1);
  const y = (value: number) => height - bottom - value / max * (height - bottom - top);
  let path = `M ${x(0)} ${y(rows[0].value)}`;
  for (let index = 1; index < rows.length; index++) {const mid = (x(index - 1) + x(index)) / 2; path += ` C ${mid} ${y(rows[index - 1].value)}, ${mid} ${y(rows[index].value)}, ${x(index)} ${y(rows[index].value)}`;}
  const tickCount = Math.min(rows.length, 8, Math.max(2, Math.floor((width - left - right) / 90) + 1));
  const ticks = [...new Set(Array.from({length: tickCount}, (_, index) => Math.round(index * (rows.length - 1) / Math.max(1, tickCount - 1))))];
  const text = dark ? "#a9c1d8" : "#6b809c", grid = dark ? "#284358" : "#e3ebf4";
  const selected = active === null ? null : rows[active];
  return <div className={`${styles.root} ${fill ? styles.fill : ""}`}><div ref={plot} className={styles.plot}><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
    <title>{label}</title><defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".20"/><stop offset="100%" stopColor={color} stopOpacity="0"/></linearGradient></defs>
    {[0, .25, .5, .75, 1].map(fraction => <g key={fraction}><line x1={left} x2={width - right} y1={y(max * fraction)} y2={y(max * fraction)} stroke={grid} strokeDasharray="3 7"/><text x={left - 12} y={y(max * fraction) + 5} textAnchor="end" fill={text} fontSize={fontSize}>{Math.round(max * fraction)}</text></g>)}
    <path d={`${path} L ${x(rows.length - 1)} ${y(0)} L ${x(0)} ${y(0)} Z`} fill={`url(#${id})`}/><path d={path} fill="none" stroke={color} strokeWidth="2.8" strokeLinejoin="round" strokeLinecap="round"/>
    {ticks.map(index => <text key={index} x={x(index)} y={height - 10} textAnchor={index === 0 ? "start" : index === rows.length - 1 ? "end" : "middle"} fill={text} fontSize={fontSize}>{rows[index].label}</text>)}
    {rows.map((row, index) => <g key={index}><circle cx={x(index)} cy={y(row.value)} r={active === index ? 5 : rows.length === 1 ? 4 : 0} fill={color}/><rect x={x(index) - (width - left - right) / Math.max(2, rows.length) / 2} y={top} width={(width - left - right) / Math.max(2, rows.length)} height={height - bottom - top} fill="transparent" tabIndex={0} aria-label={`${row.label}: ${row.value}`} onMouseEnter={() => setActive(index)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(index)} onBlur={() => setActive(null)}><title>{row.label}: {row.value}</title></rect></g>)}
  </svg></div><div aria-live="polite" className={styles.value} style={{color: text}}>{!selected ? "Passe sobre a linha para consultar os valores" : `${selected.label} · ${selected.value.toLocaleString("pt-BR",{maximumFractionDigits:2})} ${unit}`}</div></div>;
}
