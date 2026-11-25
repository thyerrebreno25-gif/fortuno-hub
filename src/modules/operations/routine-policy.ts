const normalize=(value:string="")=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
export function paymentAgenda(name:string){const text=normalize(name);return text.includes("agenda")&&text.includes("pag");}
export function reconciliation(name:string){return normalize(name).includes("concil");}
export function routinePriority(name:string,requested?:string){return paymentAgenda(name)?"HIGH":requested||"MEDIUM";}
