export function auditDate(value:unknown):string|null{
 if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
 const date=new Date(value+"T12:00:00Z");return Number.isFinite(+date)&&date.toISOString().slice(0,10)===value?value:null;
}
export function auditHistoryPeriod(periodStart:string,months=3){
 if(!auditDate(periodStart)||!Number.isInteger(months)||months<3||months>12)throw new Error("Use de 3 a 12 meses anteriores para comparação.");
 const [year,month]=periodStart.split("-").map(Number);
 return {start:new Date(Date.UTC(year,month-1-months,1,12)).toISOString().slice(0,10),end:new Date(Date.UTC(year,month-1,0,12)).toISOString().slice(0,10),months};
}
