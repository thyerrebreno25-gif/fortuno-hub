"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {OverviewSlide,ServiceSlide,OperationsSlide,FinanceSlide,EngagementSlide,WhatsAppSlide} from "./presentation-panels";
import Image from "next/image";
import {ContinuousLoop} from "./continuous-loop";
import type { ExecutiveData, ExecutivePeriod } from "./types";
import styles from "./page.module.css";

const REFRESH_MS = 300000;
const SLIDES = ["Visão geral", "Atendimento", "Operação", "Agendas", "Envios ao Conta Azul", "Onboarding", "Engajamento", "Volume WhatsApp"];
const DESCRIPTIONS = ["A operação inteira, em uma visão", "Relacionamento e distribuição da demanda", "Execução, prazos e capacidade da equipe", "O ritmo das reuniões de cada agenda", "Fluxo de lançamentos entre Hub e Conta Azul", "Implantações, entregas e pendências dos clientes", "Participação, carteira e qualidade dos atendimentos", "Satisfação, prioridades e comportamento da demanda"];
const n = (value: number) => new Intl.NumberFormat("pt-BR").format(value);
const clock = (value: number) => new Date(value).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
const countdown = (value: number) => `${Math.floor(Math.max(0, value) / 60)}:${String(Math.max(0, value) % 60).padStart(2, "0")}`;
const initial = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join("").toUpperCase();

function Glyph({ name, size = 20 }: { name: "screen" | "play" | "pause" | "left" | "right" | "refresh" | "expand" | "close"; size?: number }) {
  const paths: Record<typeof name, ReactNode> = {
    screen: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>,
    play: <path d="m8 4 12 8-12 8z" />, pause: <><path d="M8 4v16M16 4v16" /></>,
    left: <path d="m15 5-7 7 7 7" />, right: <path d="m9 5 7 7-7 7" />,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1" /></>,
    expand: <path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function Metric({ label, value, detail, accent = "cyan", available = true, href }: { label: string; value: string | number; detail: string; accent?: "cyan" | "teal" | "amber" | "rose"; available?: boolean; href?: string }) {
  const body = <><span className={styles.metricLabel}>{label}</span><strong className={styles.metricValue}>{available ? typeof value === "number" ? n(value) : value : "—"}</strong><span className={styles.metricDetail}>{available ? detail : "Sem permissão para este módulo"}</span></>;
  return href && available ? <a href={href} className={`${styles.metric} ${styles[accent]}`}>{body}<span className={styles.metricArrow}>↗</span></a> : <div className={`${styles.metric} ${styles[accent]}`}>{body}</div>;
}

function Panel({ title, eyebrow, children, right, className = "" }: { title: string; eyebrow?: string; children: ReactNode; right?: ReactNode; className?: string }) {
  return <section className={`${styles.panel} ${className}`}><header className={styles.panelHead}><div>{eyebrow && <span className={styles.eyebrow}>{eyebrow}</span>}<h3>{title}</h3></div>{right}</header>{children}</section>;
}

function Empty({ children = "Nenhum registro neste período." }: { children?: ReactNode }) { return <div className={styles.empty}>{children}</div>; }

function Bars({ rows, empty }: { rows: Array<{ label: string; value: number; color?: string; detail?: string }>; empty?: string }) {
  const max = Math.max(1, ...rows.map(row => row.value));
  if (!rows.length) return <Empty>{empty}</Empty>;
  return <div className={styles.bars}>{rows.map(row => <div className={styles.barRow} key={row.label}><div className={styles.barMeta}><span>{row.label}</span><strong>{n(row.value)}</strong></div><div className={styles.barTrack}><div style={{ width: `${Math.max(row.value ? 2 : 0, row.value / max * 100)}%`, background: row.color || "var(--bi-cyan)" }} /></div>{row.detail && <span className={styles.barDetail}>{row.detail}</span>}</div>)}</div>;
}

function Agenda({ data, now }: { data: ExecutiveData; now:number }) {
  if (!data.available.meetings) return <Empty>Sem permissão para consultar as agendas.</Empty>;
  const rows = data.meetings.agenda;
  return rows.length ? <div className={styles.agenda}>{rows.map(meeting => { const date = new Date(meeting.startsAt); const active = now >= +date && now < +new Date(meeting.endsAt); return <a key={meeting.id} className={`${styles.meeting} ${active ? styles.meetingNow : ""}`} href={meeting.id.startsWith("calendar:")?"/agenda":`/reunioes?meeting=${encodeURIComponent(meeting.id)}`}><div className={styles.meetingTime}><strong>{date.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })}</strong><span>{date.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "short" })}</span></div><div className={styles.meetingBody}><strong>{meeting.title}</strong><span>{meeting.participants.join(" · ") || "Sem participantes cadastrados"}</span></div><span className={`${styles.status} ${active ? styles.statusActive : ""}`}>{active ? "Agora" : meeting.status === "COMPLETED" ? "Realizada" : "Agendada"}</span></a>; })}</div> : <Empty>Nenhuma reunião agendada nesta janela.</Empty>;
}

export default function ExecutivePage() {
  const [data, setData] = useState<ExecutiveData | null>(null), [period, setPeriod] = useState<ExecutivePeriod>("today"), [error, setError] = useState("");
  const [lastFetchedAt,setLastFetchedAt]=useState(0);
  const [loading, setLoading] = useState(true), [restricted, setRestricted] = useState(false), [tv, setTv] = useState(false), [fullscreen, setFullscreen] = useState(false);
  const [slide, setSlide] = useState(0), [playing, setPlaying] = useState(true), [interval, setIntervalSeconds] = useState(60), [now, setNow] = useState(() => Date.now()), [frameStarted, setFrameStarted] = useState(() => Date.now());

  const contentRef=useRef<HTMLElement>(null);
  const loadedPeriod=useRef<ExecutivePeriod|null>(null);
  const root = useRef<HTMLDivElement>(null), busy = useRef(false), controller = useRef<AbortController | null>(null), lastFetch = useRef(0), requestKey = useRef(period);
  const load = useCallback(async (force = false) => {
    if (document.hidden || busy.current || (!force && Date.now() - lastFetch.current < REFRESH_MS)) return;
    busy.current = true; setLoading(true);
    const abort = new AbortController(); controller.current = abort;
    try {
      const response = await fetch(`/api/executive?period=${period}`, { cache: "no-store", signal: abort.signal });
      const payload = await response.json();
      if (!response.ok) { if (response.status === 401 || response.status === 403) { setRestricted(true); setData(null); setTv(false); } throw new Error(payload.error || "Não foi possível atualizar o painel."); }
      if (requestKey.current !== period || abort.signal.aborted) return;
      if(loadedPeriod.current!==period){setFrameStarted(Date.now());loadedPeriod.current=period;}
      setData(payload as ExecutiveData); setError(""); setRestricted(false); lastFetch.current = Date.now(); setLastFetchedAt(lastFetch.current);
    } catch (cause) { if (!abort.signal.aborted && requestKey.current === period) setError(cause instanceof Error ? cause.message : "Falha de conexão. Tentaremos novamente em instantes."); }
    finally { if (controller.current === abort) { busy.current = false; setLoading(false); } }
  }, [period]);
  useEffect(() => {
    requestKey.current = period; controller.current?.abort(); busy.current = false; lastFetch.current = 0;
    const initial = window.setTimeout(() => void load(true), 0);
    // The fixed five-minute tick must not be skipped because the previous request finished after mount.
    const poll = window.setInterval(() => void load(true), REFRESH_MS);
    const visible = () => { if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", visible);
    return () => { window.clearTimeout(initial); window.clearInterval(poll); document.removeEventListener("visibilitychange", visible); controller.current?.abort(); };
  }, [period, load]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { window.dispatchEvent(new CustomEvent("fortuno:tv-mode", { detail: { active: tv } })); if (!tv) return; const overflow = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = overflow; window.dispatchEvent(new CustomEvent("fortuno:tv-mode", { detail: { active: false } })); }; }, [tv]);
  useEffect(()=>{
    if(!tv||!("wakeLock" in navigator))return;
    let active=true,lock:WakeLockSentinel|null=null;
    const acquire=async()=>{if(document.hidden||!active)return;try{const next=await navigator.wakeLock.request("screen");if(!active)await next.release();else lock=next;}catch{}};
    void acquire();document.addEventListener("visibilitychange",acquire);
    return()=>{active=false;document.removeEventListener("visibilitychange",acquire);if(lock)void lock.release();};
  },[tv]);
  useEffect(() => { const changed = () => setFullscreen(document.fullscreenElement === root.current); document.addEventListener("fullscreenchange", changed); return () => document.removeEventListener("fullscreenchange", changed); }, []);
  useEffect(()=>{
    const init=window.setTimeout(()=>{if(new URLSearchParams(window.location.search).get("tv")==="1")setTv(true);},0);
    return()=>window.clearTimeout(init);
  },[]);

  function openTvWindow(){window.open("/painel-gerencial?tv=1","_blank","noopener,noreferrer,popup,width=1440,height=900");}
  const frameDuration = Math.max(interval, slide===2 ? (data?.operators.length||0)*8+35 : [1,6].includes(slide)?(data?.operators.length||0)*5+30:slide===3?Math.max(data?.meetings.agenda.length||0,data?.operators.length||0)*5+30:slide===4?Math.max(data?.briefing?.finance.byClient.length||0,data?.briefing?.finance.byUser.length||0)*5+30:slide===5?Math.max(data?.onboarding.projects.length||0,data?.onboarding.responsibles.length||0)*5+30:slide===7?Math.max(data?.briefing?.attention.length||0,data?.operators.length||0)*6+45:slide===0?60:30);
  const navigate = useCallback((direction: number) => {
    const stamp = Date.now(); setFrameStarted(stamp);
    setSlide(value => (value + direction + SLIDES.length) % SLIDES.length);
  }, []);
  useEffect(() => {
    if (!data || !playing || restricted || document.hidden || now - frameStarted < frameDuration * 1000) return;
    const timer = window.setTimeout(() => navigate(1), 0);
    return () => window.clearTimeout(timer);
  }, [now, playing, frameStarted, frameDuration, navigate, restricted, data]);

  useEffect(() => { const key = (event: KeyboardEvent) => { if ((event.target as HTMLElement)?.closest("input,select,textarea,[contenteditable=true]")) return; if (event.key === "ArrowRight") { event.preventDefault(); navigate(1); } else if (event.key === "ArrowLeft") { event.preventDefault(); navigate(-1); } else if (event.key === "Escape") setTv(false); }; window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key); }, [navigate]);
  useEffect(()=>{
    const element=contentRef.current;if(!element)return;element.scrollTop=0;
    if(!tv||!playing)return;
    let frame=0,last=performance.now(),held=0;
    const hold=slide===2?(data?.operators.length||0)*300/42*1000+5000:[1,6].includes(slide)?(data?.operators.length||0)*4000+5000:5000;
    const tick=(stamp:number)=>{const step=Math.min(50,stamp-last);last=stamp;
      if(!document.hidden&&!element.matches(":hover,:focus-within")&&element.scrollHeight>element.clientHeight+4){held+=step;if(held>hold){element.scrollTop+=step*.025;if(element.scrollTop>=element.scrollHeight-element.clientHeight-1){if(held>hold+(element.scrollHeight-element.clientHeight)/.025+5000){element.scrollTop=0;held=0;}}}}
      frame=requestAnimationFrame(tick);
    };frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
  },[tv,playing,slide,data]);
  async function toggleFullscreen() { try { if (document.fullscreenElement) { await document.exitFullscreen(); } else { setTv(true); await root.current?.requestFullscreen(); } } catch { setError("O navegador não permitiu tela cheia. O modo TV continua disponível."); } }
  const health = data?.whatsapp.health;
  const healthLabel = !data?.available.whatsapp ? "Sem permissão" : !health ? "Sem base" : health.critical ? "Crítico" : health.delayed ? "Atenção" : health.waiting ? "Saudável" : "Sem fila";
  const healthClass = health?.critical ? styles.healthCritical : health?.delayed ? styles.healthAmber : styles.healthGood;
  const age = data ? Math.max(0, Math.floor((now - +new Date(data.generatedAt)) / 1000)) : 0;
  const refreshIn = lastFetchedAt ? Math.max(0, Math.ceil((REFRESH_MS - (now - lastFetchedAt)) / 1000)) : 300;
  const progress = Math.min(100, Math.max(0, (now - frameStarted) / (frameDuration * 1000) * 100));
  const selectSlide = (index: number) => { setSlide(index);  setFrameStarted(now);  };
  const pageBadge = undefined;
  return <div ref={root} className={`${styles.root} ${tv ? styles.tv : ""}`}>
    <header className={styles.header}><div className={styles.brand}><div className={styles.brandMark}><Image src="/brand/fortuno-wordmark-white.png" alt="Fortuno" width={200} height={40} priority/></div><div><span className={styles.brandOverline}>FORTUNO HUB <span> / </span> INTELIGÊNCIA OPERACIONAL</span><h1>Painel gerencial</h1></div></div><div className={styles.headerActions}>{!tv&&<button className={styles.tvLaunch} onClick={openTvWindow} title="Abra em outra janela, mova para a TV e ative a tela cheia"><Glyph name="screen" size={17}/>Abrir na TV ↗</button>}<div className={styles.localClock}><strong>{clock(now)}</strong><span>{new Date(now).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "long" })} · Brasília</span></div><button className={styles.iconButton} onClick={() => { setTv(value => !value); if (tv && document.fullscreenElement) void document.exitFullscreen(); }} aria-label={tv ? "Sair do modo TV" : "Ativar modo TV"} title={tv ? "Sair do modo TV" : "Modo TV"}><Glyph name={tv ? "close" : "screen"}/></button><button className={styles.iconButton} onClick={() => void toggleFullscreen()} aria-label={fullscreen ? "Sair da tela cheia" : "Entrar em tela cheia"} title="Tela cheia"><Glyph name="expand"/></button></div></header>
    <div className={styles.toolbar}><nav aria-label="Visões do painel" className={styles.tabs}>{SLIDES.map((label, index) => <button key={label} className={slide === index ? styles.activeTab : ""} onClick={() => selectSlide(index)} aria-current={slide === index ? "page" : undefined}><span>{String(index + 1).padStart(2, "0")}</span>{label}</button>)}</nav><div className={styles.toolbarControls}><select aria-label="Período dos indicadores" value={period} onChange={event => setPeriod(event.target.value as ExecutivePeriod)}><option value="today">Hoje</option><option value="week">Últimos 7 dias</option><option value="month">Este mês</option></select><button className={styles.iconButton} onClick={() => void load(true)} disabled={loading} aria-label="Atualizar indicadores" title="Atualizar agora"><Glyph name="refresh"/></button></div></div>
    <div className={styles.slideTitle}><div><span className={styles.eyebrow}>{DESCRIPTIONS[slide]}</span><h2>{SLIDES[slide]}</h2></div><div className={styles.titleSignals}>{(slide===0||slide===1)&&<button className={`${styles.healthIndicator} ${healthClass}`} onClick={()=>selectSlide(1)}><i/>WhatsApp · {healthLabel}</button>}<div className={styles.live}><i className={error || age > 360 ? styles.staleDot : ""}/><span>{error || age > 360 ? "Dados aguardando atualização" : loading ? "Atualizando indicadores" : "Atualização automática · 5 min"}</span></div></div></div>
    {error && <div role="alert" className={styles.error}><strong>{restricted ? "Acesso restrito" : "Atualização não concluída"}</strong><span>{error}{data ? ` Exibindo os últimos dados de ${data.period.label} (${data.period.from.split("-").reverse().join("/")} a ${data.period.to.split("-").reverse().join("/")}).${data.period.key !== period ? " Esses dados ainda não correspondem ao período selecionado." : ""}` : ""}</span></div>}
    {!data ? <div className={styles.loading}>{restricted ? <><Glyph name="screen" size={38}/><h2>Este painel é exclusivo da gestão</h2><p>Entre com um perfil gerencial autorizado para consultar os indicadores.</p></> : <><span className={styles.spinner}/><h2>{error ? "Aguardando conexão" : "Reunindo os indicadores da operação"}</h2><p>Atendimento, atividades, agendas e integrações em um só lugar.</p></>}</div> : <main ref={contentRef} className={styles.content} aria-busy={loading} key={slide}>
      {!data.briefing&&<div className={styles.error}>Detalhamento complementar indisponível nesta atualização. Os indicadores gerais continuam disponíveis.</div>}
      {Boolean(data.briefing?.coverage.length)&&<div className={styles.error}>{data.briefing!.coverage.join(" ")}</div>}
      {slide === 0 && <OverviewSlide data={data} playing={playing}/> }
      {slide === 1 && <ServiceSlide data={data} playing={playing}/> }
      {slide === 2 && <OperationsSlide data={data} playing={playing}/> }
      {slide === 3 && <><div className={styles.metrics}><Metric label="Compromissos hoje" value={data.meetings.today} detail="Compromissos do Hub · horário de Brasília" available={data.available.meetings} href="/reunioes"/><Metric label="Compromissos previstos" value={data.meetings.upcoming} detail="Janela dos próximos 7 dias" available={data.available.meetings} accent="teal"/><Metric label="Reuniões realizadas" value={data.meetings.completedPeriod} detail="No período selecionado" available={data.available.meetings}/><Metric label="Clientes ativos" value={data.clients.active} detail="Base operacional da organização" available={data.available.clients} accent="amber"/></div><div className={styles.agendaGrid}><Panel title="Agenda compartilhada do Hub" eyebrow="PRÓXIMOS COMPROMISSOS · BRASÍLIA" right={pageBadge}><ContinuousLoop playing={playing} label="Agenda de reuniões"><Agenda data={data} now={now}/></ContinuousLoop></Panel><Panel title="Presença nas agendas" eyebrow="PRÓXIMOS 7 DIAS"><ContinuousLoop playing={playing} label="Presença por colaborador"><Bars rows={data.available.meetings ? [...data.operators].sort((a,b)=>b.meetingsUpcoming-a.meetingsUpcoming).map(person=>({label:person.name,value:person.meetingsUpcoming,color:"#b6a2ff"})) : []} empty="Sem informações de agenda disponíveis."/></ContinuousLoop><p className={styles.context}>Reuniões e compromissos cadastrados no Hub. Cópias da mesma reunião nas agendas dos participantes contam uma única vez.</p></Panel></div></>}
      {slide === 4 && <FinanceSlide data={data} playing={playing}/> }
      {slide === 5 && <><div className={styles.metrics}>
        <Metric label="Implantações em aberto" value={data.onboarding.active} detail={data.onboarding.inProgress+" em andamento · "+data.onboarding.notStarted+" não iniciadas"} available={data.available.onboarding} href="/onboarding"/>
        <Metric label="Implantações atrasadas" value={data.onboarding.overdue} detail="Entrega prevista anterior ao dia atual" available={data.available.onboarding} accent="rose" href="/onboarding"/>
        <Metric label="Implantações em atenção" value={data.onboarding.atRisk} detail="Bloqueios, espera ou entrega em até 3 dias" available={data.available.onboarding} accent="amber"/>
        <Metric label="Concluídas no período" value={data.onboarding.completedPeriod} detail={data.onboarding.completed+" concluídas no histórico"} available={data.available.onboarding} accent="teal"/>
      </div><div className={styles.detailGrid}>
        <Panel title="Implantações por empresa" eyebrow="PROGRESSO E PRAZOS · POSIÇÃO ATUAL" right={pageBadge}>
          {!data.available.onboarding?<Empty>Sem permissão para consultar Onboarding.</Empty>:!data.onboarding.projects.length?<Empty>Nenhuma implantação em aberto.</Empty>:<ContinuousLoop playing={playing} label="Implantações por empresa"><div className={styles.onboardingProjects}>{data.onboarding.projects.map(project=><a href="/onboarding" className={styles.onboardingProject} key={project.id}>
            <div className={styles.barMeta}><strong>{project.company}</strong><span className={project.risk==="OVERDUE"?styles.danger:project.risk==="AT_RISK"?styles.warning:styles.success}>{project.risk==="OVERDUE"?"Atrasado":project.risk==="AT_RISK"?"Atenção":"No prazo"}</span></div>
            <div className={styles.onboardingMeta}><span>{project.responsible}</span><span>Entrega {project.endDate.split("-").reverse().join("/")} · {project.progress}%</span></div>
            <div className={styles.barTrack}><div style={{width:project.progress+"%",background:"var(--bi-cyan)"}}/></div>
            <span className={styles.barDetail}>{project.pending} pendentes · {project.blocked} bloqueadas · {project.waiting} aguardando cliente</span>
          </a>)}</div></ContinuousLoop>}
        </Panel>
        <Panel title="Pendências por responsável" eyebrow="RESPONSÁVEL DA IMPLANTAÇÃO">
          {!data.available.onboarding?<Empty>Sem permissão para consultar Onboarding.</Empty>:!data.onboarding.responsibles.length?<Empty>Nenhuma pendência de implantação.</Empty>:<ContinuousLoop playing={playing} label="Pendências de implantação por responsável"><div className={styles.peopleTable}><div className={styles.peopleHeader}><span>Responsável</span><span>Implantações<br/>abertas</span><span>Tarefas<br/>pendentes</span></div>{data.onboarding.responsibles.map(person=><div className={styles.personRow} key={person.name}><div className={styles.person}><span className={styles.avatar}>{initial(person.name)}</span><strong>{person.name}</strong></div><span className={styles.number}>{n(person.active)}</span><span className={styles.number}>{n(person.pending)}</span></div>)}</div></ContinuousLoop>}
          <p className={styles.context}>Inclui responsáveis informados por nome e implantações sem responsável. Atribuição pelo responsável principal de cada implantação.</p>
        </Panel>
      </div><div className={styles.summaryStrip}><span><strong>{data.available.onboarding?n(data.onboarding.pendingTasks):"—"}</strong> tarefas pendentes</span><span><strong>{data.available.onboarding?n(data.onboarding.blockedTasks):"—"}</strong> tarefas bloqueadas</span><span><strong>{data.available.onboarding?n(data.onboarding.waitingClient):"—"}</strong> aguardando cliente</span><span><strong>{data.available.onboarding?n(data.onboarding.notStarted):"—"}</strong> implantações não iniciadas</span></div></>}
      {slide === 6 && <EngagementSlide data={data} playing={playing}/> }
      {slide === 7 && <WhatsAppSlide data={data} playing={playing}/> }
    </main>}
    <footer className={styles.footer}><div className={styles.dataStamp}><span className={styles.sourceDot}/><span>{data ? `Dados de ${clock(+new Date(data.generatedAt))} · ${data.period.label}` : "Conectando às fontes do Hub"}</span><span className={styles.footerDivider}/><span>Próxima atualização em {countdown(refreshIn)}</span></div><div className={styles.playback}><span className={styles.dataStamp} aria-label="Tempo para a próxima tela">{playing ? `Próxima tela em ${countdown(Math.max(0, Math.ceil(frameDuration - (now - frameStarted) / 1000)))}` : "Troca de telas pausada"}</span><button className={styles.iconButton} onClick={()=>navigate(-1)} aria-label="Visão anterior"><Glyph name="left" size={16}/></button><button className={styles.playButton} onClick={()=>{setPlaying(value=>!value);setFrameStarted(Date.now());}} aria-label={playing ? "Pausar navegação automática" : "Iniciar navegação automática"}><Glyph name={playing ? "pause" : "play"} size={15}/><span>{playing ? "Automático" : "Pausado"}</span></button><select aria-label="Tempo base de cada visão" title="Listas longas ampliam o tempo para percorrer todos os colaboradores." value={interval} onChange={event=>{setIntervalSeconds(Number(event.target.value));setFrameStarted(Date.now());}}><option value={15}>15 s</option><option value={30}>30 s</option><option value={60}>60 s</option></select><button className={styles.iconButton} onClick={()=>navigate(1)} aria-label="Próxima visão"><Glyph name="right" size={16}/></button></div></footer>
    {!tv&&<p className={styles.tvHint}>Use “Abrir na TV” para apresentar em outra janela enquanto trabalha no Hub. A apresentação percorre listas e conteúdo automaticamente; pause ou passe o mouse para consultar. Listas longas ampliam o tempo de leitura.</p>}
    {data?.notes.length ? <details className={styles.notes}><summary>Critérios e cobertura dos dados ({data.notes.length})</summary>{data.notes.map((note,index)=><p key={index}>{note}</p>)}</details> : null}
    <div className={styles.rotationTrack} aria-hidden="true"><div style={{width:playing ? `${progress}%` : "0%"}}/></div>
  </div>;
}
