export function mergeChatMessages<T extends {id:string;receivedAt:string}>(current:T[],incoming:T[]):T[]{
  const rows=new Map(current.map(row=>[row.id,row]));
  for(const row of incoming){const previous=rows.get(row.id);rows.set(row.id,previous && JSON.stringify(previous)===JSON.stringify(row)?previous:row);}
  const merged=[...rows.values()].sort((a,b)=>a.receivedAt.localeCompare(b.receivedAt)||a.id.localeCompare(b.id));
  return merged.length===current.length && merged.every((row,index)=>row===current[index])?current:merged;
}
