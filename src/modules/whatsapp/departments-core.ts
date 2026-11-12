export const DEFAULT_DEPARTMENTS = [
 {value:"ACCOUNTS_PAYABLE",label:"Contas a pagar"},
 {value:"ACCOUNTS_RECEIVABLE",label:"Contas a receber"},
 {value:"GENERAL",label:"Atendimento geral"},
];
export type WhatsAppDepartmentOption={id:string;name:string;active:boolean};
export const departmentNameKey=(name:string)=>name.trim().normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("pt-BR").replace(/\s+/g," ");
