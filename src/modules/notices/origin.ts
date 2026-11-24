import type {Prisma} from "@/generated/prisma/client";

export const noticeOriginOptions = [
  {value:"all",label:"Todas as origens"},
  {value:"disregard",label:"Autorizações de desconsideração"},
  {value:"daily",label:"Atividades Daily"},
  {value:"operations",label:"Gestão de tarefas (todos)"},
  {value:"other",label:"Outros avisos"},
];
export type NoticeOrigin = "all"|"disregard"|"daily"|"operations"|"other";
export function validNoticeOrigin(value:string):value is NoticeOrigin{return noticeOriginOptions.some(option=>option.value===value);}
const disregard:Prisma.NoticeWhereInput={id:{startsWith:"operation-disregard:"}};
// Legacy Daily notices predate an explicit origin prefix. Their generated
// title + destination signature is kept so existing notices are filterable.
const daily:Prisma.NoticeWhereInput={OR:[{id:{startsWith:"daily-overdue:"}},{AND:[{title:{startsWith:"Atividade não concluída ·"}},{body:{contains:"Acompanhe em Atividades Daily ou na reunião:"}}]}]};
const operations:Prisma.NoticeWhereInput={OR:[{id:{startsWith:"operation-"}},{body:{contains:"/operacoes?activity="}}]};
export function noticeOriginWhere(origin:NoticeOrigin):Prisma.NoticeWhereInput{
  if(origin==="disregard")return disregard;
  if(origin==="daily")return daily;
  if(origin==="operations")return operations;
  if(origin==="other")return {NOT:{OR:[daily,operations]}};
  return {};
}
export function noticeOriginLabel(notice:{id:string;title:string;body:string|null}){
  if(notice.id.startsWith("operation-disregard:"))return "Desconsideração";
  if(notice.id.startsWith("daily-overdue:")||notice.title.startsWith("Atividade não concluída ·")&&notice.body?.includes("Acompanhe em Atividades Daily ou na reunião:"))return "Atividades Daily";
  if(notice.id.startsWith("operation-")||notice.body?.includes("/operacoes?activity="))return "Gestão de tarefas";
  return "Outros avisos";
}
