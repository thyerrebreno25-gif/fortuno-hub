export function mergeChatMessages<T extends {id:string;receivedAt:string;clientRequestId?:string|null;reconciledEchoId?:string|null}>(current:T[],incoming:T[]):T[]{
  const rows=new Map(current.map(row=>[row.id,row]));
  // Replace only the optimistic record acknowledged by this durable message.
  // An unrelated successful send must never erase an earlier uncertain attempt.
  for(const row of incoming)if(!row.id.startsWith("pending:")&&row.clientRequestId)rows.delete("pending:"+row.clientRequestId);
  for(const row of incoming)if(row.reconciledEchoId)rows.delete(row.reconciledEchoId);
  for(const row of incoming){const previous=rows.get(row.id);rows.set(row.id,previous && JSON.stringify(previous)===JSON.stringify(row)?previous:row);}
  const merged=[...rows.values()].sort((a,b)=>a.receivedAt.localeCompare(b.receivedAt)||a.id.localeCompare(b.id));
  return merged.length===current.length && merged.every((row,index)=>row===current[index])?current:merged;
}
