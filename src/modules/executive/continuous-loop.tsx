"use client";
import {useEffect,useRef,useState,type CSSProperties,type ReactNode} from "react";
import styles from "./presentation.module.css";

/** One real list plus an inert visual copy; the copy never duplicates focus targets. */
export function ContinuousLoop({children,horizontal=false,playing=true,label}:{children:ReactNode;horizontal?:boolean;playing?:boolean;label:string}){
 const viewport=useRef<HTMLDivElement>(null),first=useRef<HTMLDivElement>(null);
 const [distance,setDistance]=useState(0);
 useEffect(()=>{
  const element=viewport.current,content=first.current;if(!element||!content)return;
  const measure=()=>{const length=horizontal?content.scrollWidth:content.scrollHeight,available=horizontal?element.clientWidth:element.clientHeight;setDistance(length>available+2?length:0);};
  const observer=new ResizeObserver(measure);observer.observe(element);observer.observe(content);measure();return()=>observer.disconnect();
 },[horizontal,children]);
 return <div ref={viewport} className={`${styles.loop} ${horizontal?styles.horizontal:""}`} data-loop-running={Boolean(distance&&playing)} role="region" aria-label={label} tabIndex={0} style={{"--loop-distance":`${distance}px`,"--loop-duration":`${Math.max(12,distance/(horizontal?42:20))}s`} as CSSProperties}>
  <div className={styles.loopTrack}><div ref={first} className={styles.loopGroup}>{children}</div>{distance>0&&<div className={styles.loopGroup} aria-hidden="true" inert>{children}</div>}</div>
 </div>;
}
