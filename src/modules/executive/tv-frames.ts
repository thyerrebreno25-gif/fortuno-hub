export type TvFrame={items:Array<{index:number;top:number}>;height:number;scale:number;seconds:number};
/** Pack whole blocks into the physical viewport; oversize blocks scale as a unit. */
export function fitTvFrames(heights:number[],available:number,durations:number[]=[],gap=16):TvFrame[]{
 const room=Math.max(1,available),frames:TvFrame[]=[];
 for(let index=0;index<heights.length;index++){
  const height=Math.max(1,heights[index]||1),seconds=Math.max(12,durations[index]||0);
  const last=frames.at(-1),top=last?last.height+gap:0;
  if(last&&last.scale===1&&top+height<=room){last.items.push({index,top});last.height=top+height;last.seconds=Math.max(last.seconds,seconds);}
  else frames.push({items:[{index,top:0}],height,scale:Math.min(1,room/height),seconds});
 }
 return frames;
}
