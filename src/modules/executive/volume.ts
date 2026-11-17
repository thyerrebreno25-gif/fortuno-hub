export function volumeDistribution(rows: Array<{weekday: number; day: number; hour: number; count: number | bigint}>) {
  const weekdays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map(label => ({label, value: 0}));
  const monthDays = Array.from({length: 31}, (_, index) => ({label: String(index + 1), value: 0}));
  const hours = Array.from({length: 24}, (_, index) => ({label: `${String(index).padStart(2, "0")}h`, value: 0}));
  for (const row of rows) {if (weekdays[row.weekday]) weekdays[row.weekday].value += Number(row.count); if (monthDays[row.day - 1]) monthDays[row.day - 1].value += Number(row.count); if (hours[row.hour]) hours[row.hour].value += Number(row.count);}
  return {weekdays, monthDays, hours};
}
