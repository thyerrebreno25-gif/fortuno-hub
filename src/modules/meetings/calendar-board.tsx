"use client";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { calendarDate, calendarRange, dayStart, layoutDay, type CalendarView } from "./calendar-layout";
import styles from "./calendar.module.css";

export type CalendarItem = { id: string; title: string; startsAt: string; endsAt: string; external: boolean; allDay: boolean };
const weekdays = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"];
const dateLabel = (key: string) => calendarDate(key).toLocaleDateString("pt-BR", { timeZone: "UTC", dateStyle: "full" });
const itemKey = (item: CalendarItem) => `${item.external ? "google" : "hub"}:${item.id}`;
const intersects = (item: CalendarItem, key: string) => +new Date(item.startsAt) < dayStart(key) + 86400000 && +new Date(item.endsAt) > dayStart(key);

export function MiniCalendar({ anchor, today, onDate }: { anchor: string; today: string; onDate: (key: string) => void }) {
  const days = calendarRange(anchor, "month").days;
  return <div className={styles.mini} aria-label="Seletor de datas">
    {weekdays.map((day) => <span key={day} className={styles.miniHeading}>{day.slice(0, 1)}</span>)}
    {days.map((key) => <button key={key} type="button" aria-label={dateLabel(key)} aria-pressed={key === anchor} data-today={key === today} data-outside={key.slice(0, 7) !== anchor.slice(0, 7)} onClick={() => onDate(key)}>{Number(key.slice(-2))}</button>)}
  </div>;
}

export function CalendarBoard<T extends CalendarItem>({ anchor, view, today, items, renderItem, onDate, onCreate }: {
  anchor: string; view: CalendarView; today: string; items: T[]; renderItem: (item: T) => ReactNode; onDate: (key: string) => void; onCreate?: (key: string, minutes: number) => void;
}) {
  const days = calendarRange(anchor, view).days;
  const timeline = useRef<HTMLDivElement>(null);
  useEffect(() => { if (timeline.current) timeline.current.scrollTop = 7 * 60; }, [view]);
  const [clock, setClock] = useState<Date | null>(null);
  useEffect(() => {
    void Promise.resolve().then(() => setClock(new Date()));
    const timer = window.setInterval(() => setClock(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  if (view === "list") return <div className={styles.agendaList}>
    {!items.length && <p className={styles.empty}>Nenhum compromisso neste período.</p>}
    {days.map((key) => {
      const events = items.filter((item) => intersects(item, key));
      return events.length ? <section key={key} className={styles.listDay}><button className={styles.listDate} onClick={() => onDate(key)}><strong>{Number(key.slice(-2))}</strong><span>{dateLabel(key)}</span></button><div>{events.map((item) => <div key={itemKey(item)}>{renderItem(item)}</div>)}</div></section> : null;
    })}
  </div>;
  if (view === "month") return <div className={styles.boardScroll}><div className={styles.monthGrid}>
    {weekdays.map((day) => <div key={day} className={styles.weekday}>{day}</div>)}
    {days.map((key) => <section className={styles.monthDay} key={key} data-outside={key.slice(0, 7) !== anchor.slice(0, 7)} aria-label={dateLabel(key)}>
      {onCreate && <button className={styles.monthCreate} aria-label={`Criar evento em ${dateLabel(key)}`} onClick={() => onCreate(key, 9 * 60)} />}
      <button className={styles.dayNumber} data-today={key === today} aria-label={`Abrir ${dateLabel(key)}`} onClick={() => onDate(key)}>{Number(key.slice(-2))}</button>
      {items.filter((item) => intersects(item, key)).map((item) => <div key={itemKey(item)}>{renderItem(item)}</div>)}
    </section>)}
  </div></div>;
  const columns = { "--calendar-days": days.length } as CSSProperties;
  const currentMinutes = clock ? (clock.getTime() - dayStart(today)) / 60000 : -1;
  return <div ref={timeline} className={styles.timelineScroll} aria-label={view === "week" ? "Agenda semanal por horário" : "Agenda diária por horário"}>
    <div className={styles.timeGrid} style={columns}>
      <div className={styles.timeHeader}>
        <div className={styles.timezone}>GMT−03</div>
        {days.map((key) => <button key={key} className={styles.columnHeading} onClick={() => onDate(key)} aria-label={`Abrir ${dateLabel(key)}`}><span>{weekdays[calendarDate(key).getUTCDay()]}</span><strong data-today={key === today}>{Number(key.slice(-2))}</strong></button>)}
        <span className={styles.allDayLabel}>Dia todo</span>
        {days.map((key) => <div className={styles.allDayCell} key={key}>{items.filter((item) => item.allDay && intersects(item, key)).map((item) => <div key={itemKey(item)}>{renderItem(item)}</div>)}</div>)}
      </div>
      <div className={styles.timeBody}>
        <div className={styles.hours}>{Array.from({ length: 24 }, (_, hour) => <span key={hour} style={{ top: hour * 60 }}>{String(hour).padStart(2, "0")}:00</span>)}</div>
        {days.map((key) => <div key={key} className={styles.timeColumn}>
          {onCreate && Array.from({ length: 48 }, (_, slot) => <button key={slot} className={styles.timeSlot} style={{ top: slot * 30 }} aria-label={`Criar evento em ${dateLabel(key)} às ${String(Math.floor(slot / 2)).padStart(2, "0")}:${slot % 2 ? "30" : "00"}`} onClick={() => onCreate(key, slot * 30)} />)}
          {layoutDay(items.filter((item) => !item.allDay), key).map(({ event, top, visualBottom, column, columns }) => <div key={itemKey(event)} className={styles.timeEvent} style={{ top, height: visualBottom - top, left: `calc(${column / columns * 100}% + 2px)`, width: `calc(${100 / columns}% - 5px)` }}>{renderItem(event)}</div>)}
          {key === today && currentMinutes >= 0 && currentMinutes < 1440 && <div className={styles.nowLine} style={{ top: currentMinutes }} aria-label="Horário atual" />}
        </div>)}
      </div>
    </div>
  </div>;
}

