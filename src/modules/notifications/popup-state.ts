export function notificationIds(value: string | null): string[] {
 try {const ids=JSON.parse(value || "[]");return Array.isArray(ids)?ids.filter((id):id is string=>typeof id === "string").slice(-1000):[];}catch{return [];}
}
export function popupBatch<T extends {id:string;popup?:boolean}>(items:T[],seen:string[],read:string[]) {
 const known=new Set([...seen,...read]);const fresh=items.filter(item=>item.popup&&!known.has(item.id));
 return {show:fresh.slice(0,3),seen:[...new Set([...seen,...fresh.map(item=>item.id)])].slice(-1000)};
}
