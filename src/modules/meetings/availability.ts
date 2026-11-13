export function mergeBusy(intervals: Array<{ startsAt: string | Date; endsAt: string | Date }>, from: Date, to: Date) {
  const sorted = intervals.map(item => ({ start: Math.max(+from, +new Date(item.startsAt)), end: Math.min(+to, +new Date(item.endsAt)) }))
    .filter(item => item.start < item.end).sort((a, b) => a.start - b.start);
  const merged: typeof sorted = [];
  for (const item of sorted) {
    const last = merged.at(-1);
    if (last && item.start <= last.end) last.end = Math.max(last.end, item.end);
    else merged.push({ ...item });
  }
  return merged.map(item => ({ startsAt: new Date(item.start).toISOString(), endsAt: new Date(item.end).toISOString() }));
}
