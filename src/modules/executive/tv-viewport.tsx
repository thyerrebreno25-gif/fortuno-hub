"use client";
import {Children,createContext,useContext,useEffect,useLayoutEffect,useMemo,useRef,useState,type ReactNode} from "react";
import {fitTvFrames,type TvFrame} from "./tv-frames";
import styles from "./tv-viewport.module.css";
type Configuration={enabled:boolean;playing:boolean;scene:number;onDuration:(seconds:number)=>void};
export const TvPresentationContext=createContext<Configuration|null>(null);
export function TvScreen({children}:{children:ReactNode}){const config=useContext(TvPresentationContext);return config?<TvViewport {...config}>{children}</TvViewport>:<>{children}</>;}
export function TvViewport({children,enabled,playing,scene,onDuration}:{children:ReactNode;enabled:boolean;playing:boolean;scene:number;onDuration:(seconds:number)=>void}){
 const nodes=useMemo(()=>Children.toArray(children),[children]),root=useRef<HTMLDivElement>(null),items=useRef(new Map<number,HTMLDivElement>());
 const [frames,setFrames]=useState<TvFrame[]>([]),[page,setPage]=useState(0);
 useLayoutEffect(()=>{
  if(!enabled)return;const element=root.current;if(!element)return;
  const measure=()=>{const heights=nodes.map((_,index)=>items.current.get(index)?.offsetHeight||0),durations=nodes.map((_,index)=>Math.max(0,...Array.from(items.current.get(index)?.querySelectorAll<HTMLElement>('[data-loop-running="true"]')||[]).map(loop=>parseFloat(loop.style.getPropertyValue('--loop-duration'))+4)));const next=fitTvFrames(heights,element.clientHeight-28,durations);setFrames(current=>JSON.stringify(current)===JSON.stringify(next)?current:next);};
  const observer=new ResizeObserver(measure);observer.observe(element);items.current.forEach(item=>observer.observe(item));const timer=setTimeout(measure,0);return()=>{observer.disconnect();clearTimeout(timer);};
 },[enabled,nodes]);
 useEffect(()=>{if(!enabled)return;const timer=setTimeout(()=>onDuration(frames.reduce((sum,frame)=>sum+frame.seconds,0)),0);return()=>clearTimeout(timer);},[enabled,frames,onDuration]);
 useEffect(()=>{const timer=setTimeout(()=>setPage(0),0);return()=>clearTimeout(timer);},[scene]);
 const current=Math.min(page,Math.max(0,frames.length-1)),frame=frames[current];
 useEffect(()=>{if(!enabled||!playing||frames.length<2)return;let elapsed=0;const timer=setInterval(()=>{if(document.hidden)return;elapsed++;if(elapsed>=(frame?.seconds||12)){elapsed=0;setPage(value=>(value+1)%frames.length);}},1000);return()=>clearInterval(timer);},[enabled,playing,frames.length,frame?.seconds]);
 if(!enabled)return <>{children}</>;
 return <div ref={root} className={styles.viewport} data-tv-fit="true" aria-label="Quadros automáticos da TV">{nodes.map((node,index)=>{const slot=frame?.items.find(item=>item.index===index),visible=Boolean(slot);return <div key={index} ref={element=>{if(element)items.current.set(index,element);else items.current.delete(index);}} className={styles.block} aria-hidden={!visible} inert={!visible} style={{visibility:visible?"visible":"hidden",top:slot?slot.top*(frame?.scale||1):0,transform:`scale(${visible?frame?.scale||1:1})`,...(visible&&frame?.scale!==1?{left:`${(1-(frame?.scale||1))*50}%`}:{})}}>{node}</div>;})}{frames.length>1&&<div className={styles.indicator} aria-live="polite">Quadro {current+1} de {frames.length} · alternância automática</div>}</div>;
}
