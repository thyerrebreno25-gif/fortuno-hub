import {describe,it,expect} from "vitest";
import {parseUnicredInvoice} from "./unicred-parser";
import type {PdfTextLine} from "../pdf-reader.client";
const line=(page:number,y:number,parts:Array<[number,string]>):PdfTextLine=>({page,y,text:parts.map(p=>p[1]).join(" "),parts:parts.map(([x,text])=>({x,text}))});
const header=(page=1)=>[line(page,655,[[101,"T O T A L :"],[147,"1 0 0 , 0 0"],[236,"V E N C I M E N T O :"],[296,"2 2"],[309,"O U T"],[329,"2 0 2 6"]]),line(page,640,[[75,"L A N Ç A M E N T O S – VISA 4338**.******.4555"]])];
const tx=(y:number,date:string,description:string,value:string,page=1)=>line(page,y,[[82,date],[129,description],[481,value]]);
describe("Unicred",()=>{
 it("reads spaced letters, credits, installments and payment without counting old payment as expense",()=>{
  const source=header();source[0].parts!.splice(1,0,{x:133,text:"R $"});source[0].text=source[0].parts!.map(p=>p.text).join(" ");
  const result=parseUnicredInvoice([...source,tx(600,"0 3 / j u n","L O J A Parc. 5/10","R $ 1 2 1 , 5 0"),tx(560,"1 4 / s e t","Anuidade - bonificação","-R$ 21,50"),tx(520,"2 2 / s e t","Pagamento Recebido","-R$ 900,00")]);
  expect(result.dueDate).toBe("2026-10-22");expect(result.invoiceTotal).toBe(100);
  expect(result.items).toHaveLength(3);expect(result.items[0]).toMatchObject({date:"2026-06-03",installment:"5/10",cardLastDigits:"4555",amount:121.5,exportable:true});
  expect(result.items[1]).toMatchObject({amount:-21.5,transactionType:"INVOICE_CREDIT",exportable:true});expect(result.items[2]).toMatchObject({transactionType:"INVOICE_PAYMENT",exportable:false});
  expect(result.warnings.some(w=>w.includes("soma"))).toBe(false);
 });
 it("joins international descriptions above the dated BRL row and excludes exchange quotes and subtotals",()=>{
  const result=parseUnicredInvoice([...header(),line(1,606,[[128,"S E R V I C O -"],[242,"U S D"],[266,"1 0 . 0 0"]]),tx(600,"01/out","","R$ 50,00"),line(1,596,[[128,"Conversão: USD 1 = R$ 5,00"]]),tx(560,"01/out","IOF compra internacional - SERVICO","R$ 1,75"),line(1,530,[[75,"TOTAL DE PESSOA R$ 51,75"]])]);
  expect(result.items).toHaveLength(2);expect(result.items[0]).toMatchObject({description:"SERVICO",transactionType:"INTERNATIONAL_PURCHASE",amount:50});expect(result.items[1].transactionType).toBe("INTERNATIONAL_IOF");
  expect(result.warnings.some(w=>w.includes("total da fatura Unicred não foi identificado"))).toBe(true);
 });
 it("preserves repeated legitimate purchases and infers previous year for old installments",()=>{
  const result=parseUnicredInvoice([...header(),tx(600,"16/out","SERVICO Parc.12/12","R$ 10,00"),tx(560,"02/out","LOJA","R$ 33,00"),tx(520,"02/out","LOJA","R$ 33,00")]);
  expect(result.items[0].date).toBe("2025-10-16");expect(result.items.filter(i=>i.amount===33)).toHaveLength(2);
 });
 it("does not read summary, rates, advertising or dates outside the transactions section",()=>{
  const result=parseUnicredInvoice([...header(),tx(600,"01/out","LOJA","R$ 10,00"),line(1,500,[[75,"TOTAL DE PESSOA R$ 10,00"]]),tx(450,"01/out","NOT A PURCHASE","R$ 99,00"),tx(600,"01/out","NEXT PAGE FOOTER","R$ 99,00",2)]);
  expect(result.items).toHaveLength(1);
 });
 it("reports a mismatch instead of silently replacing the printed invoice total",()=>{
  const source=header();source[0].parts!.splice(1,0,{x:133,text:"R $"});source[0].text=source[0].parts!.map(p=>p.text).join(" ");
  const result=parseUnicredInvoice([...source,tx(600,"01/out","LOJA","R$ 10,00")]);
  expect(result.invoiceTotal).toBe(100);expect(result.warnings.some(w=>w.includes("mas a fatura informa"))).toBe(true);
 });
 it("requires complete due date and an identifiable transaction",()=>{
  expect(()=>parseUnicredInvoice([])).toThrow("vencimento");expect(()=>parseUnicredInvoice(header())).toThrow("Nenhum lançamento");
 });
});
