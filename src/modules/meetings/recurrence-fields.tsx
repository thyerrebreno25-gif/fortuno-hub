"use client";
import { Checkbox, Group, Paper, Select, Stack, Text, TextInput } from "@mantine/core";
import { meetingOccurrences, meetingWeekdays, type MeetingRecurrence } from "./recurrence";
import { formatMeetingDate, inputToIso } from "./client";
export type RecurrenceForm = { frequency: "NONE" | "DAILY" | "WEEKLY"; weekdays: number[]; until: string };
export function recurrenceValue(form: RecurrenceForm): MeetingRecurrence | null {
  return form.frequency === "NONE" ? null : { frequency: form.frequency, weekdays: form.weekdays, until: form.until };
}
export function recurrencePreview(startsAt: string, endsAt: string, form: RecurrenceForm) {
  try { return { dates: meetingOccurrences(new Date(inputToIso(startsAt)), new Date(inputToIso(endsAt)), recurrenceValue(form)), error: "" }; }
  catch(error) { return { dates: [], error: error instanceof Error ? error.message : "Confira as datas." }; }
}
export function MeetingRecurrenceFields({ value, onChange, startsAt, endsAt }: { value: RecurrenceForm; onChange: (value: RecurrenceForm) => void; startsAt: string; endsAt: string }) {
  const preview = recurrencePreview(startsAt, endsAt, value);
  return <Paper withBorder p="sm" radius="md"><Stack gap="sm">
    <Select label="Recorrência" value={value.frequency} allowDeselect={false} data={[{value:"NONE",label:"Não repetir"},{value:"DAILY",label:"Todos os dias"},{value:"WEEKLY",label:"Dias da semana"}]} onChange={frequency => onChange({...value,frequency:frequency as RecurrenceForm["frequency"]})}/>
    {value.frequency !== "NONE" && <>
      {value.frequency === "WEEKLY" && <div><Text size="sm" fw={500} mb={6}>Repetir nos dias</Text><Group gap="sm">{meetingWeekdays.map(day => <Checkbox key={day.value} label={day.label} checked={value.weekdays.includes(day.value)} onChange={event => onChange({...value,weekdays:event.currentTarget.checked?[...value.weekdays,day.value]:value.weekdays.filter(value=>value!==day.value)})}/>)}</Group></div>}
      <TextInput type="date" label="Repetir até" required min={startsAt.slice(0,10)} value={value.until} onChange={event=>onChange({...value,until:event.currentTarget.value})}/>
      <Text size="xs" c={preview.error?"red":"dimmed"}>{preview.error || `${preview.dates.length} reuniões independentes · ${formatMeetingDate(preview.dates[0].startsAt.toISOString())} até ${formatMeetingDate(preview.dates.at(-1)!.startsAt.toISOString())}. O horário e a duração se repetem.`}</Text>
      {!preview.error && <details><summary style={{cursor:"pointer",fontSize:12}}>Conferir todas as datas</summary><Stack gap={3} mt={6} mah={160} style={{overflowY:"auto"}}>{preview.dates.map(date=><Text key={date.startsAt.toISOString()} size="xs">{formatMeetingDate(date.startsAt.toISOString())} — {formatMeetingDate(date.endsAt.toISOString())}</Text>)}</Stack></details>}
    </>}
  </Stack></Paper>;
}
