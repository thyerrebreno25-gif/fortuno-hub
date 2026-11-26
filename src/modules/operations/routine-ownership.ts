const normalize=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
export type RoutineOwnerFamily="payments"|"receipts";
export function reconciliationFamily(name:string):RoutineOwnerFamily|null {
 const n=normalize(name);return n.includes("concil")&&n.includes("pagamento")?"payments":n.includes("concil")&&n.includes("recebimento")?"receipts":null;
}
export function inheritedRoutineFamily(name:string):RoutineOwnerFamily|null {
 const n=normalize(name);
 if(reconciliationFamily(name))return null;
 if(n.includes("agenda")&&n.includes("pagamento")||n.includes("fatura")&&n.includes("cart"))return "payments";
 if(n.includes("rendimento")&&n.includes("aplica")||n.includes("meio")&&n.includes("receb")||n.includes("adquirente")||n.includes("import")&&/recebive|recebimento/.test(n)||/emi(ss|t)/.test(n)&&n.includes("nota")||n.includes("lanc")&&n.includes("recebimento"))return "receipts";
 return null;
}
type Routine={clientId:string;responsibleId:string|null;process:{name:string}};
export function reconciliationOwner(routines:Routine[],clientId:string,family:RoutineOwnerFamily){
 const ids=[...new Set(routines.filter(r=>r.clientId===clientId&&reconciliationFamily(r.process.name)===family).map(r=>r.responsibleId).filter((id):id is string=>Boolean(id)))];
 if(ids.length>1)throw new Error("Há responsáveis diferentes nas conciliações deste cliente. Unifique a conciliação antes de marcar as atividades vinculadas.");
 return ids[0]||null;
}
