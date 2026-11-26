import {batchAddress,batchClientRecipient,type BatchDestination} from "./batch-recipients";
export type BroadcastSelection={id:string;name:string;destination:BatchDestination};
export type BroadcastTarget={clientId:string;address:string};
export function resolveBroadcast(targets:BroadcastTarget[],clients:Array<{id:string;name:string;serviceTickets:BatchDestination[]}>){
 const selections:BroadcastSelection[]=[],addresses=new Set<string>();
 for(const target of targets){const client=clients.find(c=>c.id===target.clientId);if(!client||selections.some(s=>s.id===client.id))continue;
  const destination=batchClientRecipient(client).destinations.find(t=>batchAddress(t.senderEmail)===target.address);
  if(!destination||addresses.has(target.address))continue;addresses.add(target.address);selections.push({id:client.id,name:client.name,destination});
 }
 return {selections,unavailable:targets.length-selections.length};
}
