"use client";
let context:AudioContext|null=null;
let lastPlayed=0;
const heard=new Set<string>();
export function unlockMessageSound(){
  try{if(!context && window.AudioContext)context=new AudioContext();if(context?.state==="suspended")void context.resume().catch(()=>{});}catch{/* Audio stays optional when the browser blocks it. */}
}
export const messageSoundReady=()=>context?.state==="running";
export function freshMessageSound(items:Array<{id:string;createdAt:string}>,since:number){
  return items.find(item=>item.id.startsWith("whatsapp-message-") && Date.parse(item.createdAt)>=since)?.id||null;
}
export async function playMessageBlip(scope:string,id:string){
  if(!messageSoundReady()||heard.has(id)||Date.now()-lastPlayed<2500)return;
  heard.add(id);if(heard.size>1000)heard.delete(heard.values().next().value!);
  const play=()=>{
    const audio=context;if(!audio||audio.state!=="running")return;
    const key="fortuno-message-sound:"+scope;
    try{const previous=JSON.parse(localStorage.getItem(key)||"null");if(previous?.id===id||Date.now()-Number(previous?.at)<2500)return;localStorage.setItem(key,JSON.stringify({id,at:Date.now()}));}catch{/* In-memory deduplication remains active with storage disabled. */}
    lastPlayed=Date.now();
    const start=audio.currentTime,gain=audio.createGain();gain.connect(audio.destination);
    gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(0.12,start+0.015);gain.gain.exponentialRampToValueAtTime(0.001,start+0.24);
    const tone=audio.createOscillator();tone.type="sine";tone.frequency.setValueAtTime(740,start);tone.frequency.setValueAtTime(990,start+0.10);tone.connect(gain);tone.start(start);tone.stop(start+0.25);tone.onended=()=>{tone.disconnect();gain.disconnect();};
  };
  try{if(navigator.locks)await navigator.locks.request("fortuno-message-sound:"+scope,{ifAvailable:true},lock=>{if(lock)play();});else play();}catch{/* Do not interrupt the inbox when sound is unavailable. */}
}
