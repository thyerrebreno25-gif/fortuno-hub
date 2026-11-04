import {describe,expect,it} from "vitest";
import fixture from "./__fixtures__/safra-pj.json";
import {parseSafraStatement} from "./safra";
import {generateOfx} from "../ofx";
const clone = () => structuredClone(fixture);
describe("Safra PJ conta corrente", () => {
 it("reads all four pages, preserving repeated yields and excluding balance rows", () => {
  const parsed=parseSafraStatement(clone());
  expect(parsed).toMatchObject({bank:"Safra",branch:"0001",account:"00000001-0",periodStart:"2026-07-17",periodEnd:"2026-10-15",detectedOpeningBalance:907.54,detectedClosingBalance:4694.24});
  expect(parsed.transactions).toHaveLength(56);
  const sum=(type:string)=>Math.round(parsed.transactions.filter(t=>t.type===type).reduce((total,t)=>total+Math.round(t.amount*100),0))/100;
  expect(sum("CREDIT")).toBe(727942.69);expect(sum("DEBIT")).toBe(724156);
  expect(parsed.transactions.filter(t=>t.sourceType==="RENDIMENTO CDB AUTOMATICO")).toHaveLength(43);
  expect(parsed.transactions.every(t=>!t.description.startsWith("SALDO"))).toBe(true);
 });
 it("detects the original one-cent discrepancy without fabricating a transaction or changing the opening balance", () => {
  const parsed=parseSafraStatement(clone());
  expect(parsed.balanceWarnings).toHaveLength(1);expect(parsed.balanceWarnings![0]).toContain("05/10");expect(parsed.balanceWarnings![0]).toContain("2.849,88");expect(parsed.balanceWarnings![0]).toContain("2.849,89");
  expect(parsed.detectedOpeningBalance).toBe(907.54);
  expect(parsed.transactions.at(-1)?.amount).toBe(6156);
 });
 it("confirms a balanced statement without hiding a one-cent discrepancy", () => {
  const balanced=clone();const row=balanced.find(l=>l.text.startsWith("05/10 RENDIMENTO"))!;
  row.parts.at(-1)!.text="1,21";
  const parsed=parseSafraStatement(balanced);
  expect(parsed.balanceWarnings).toEqual([]);
  const calculated=parsed.transactions.reduce((total,t)=>total+(t.type==="CREDIT"?1:-1)*Math.round(t.amount*100),Math.round(parsed.detectedOpeningBalance!*100));
  expect(calculated).toBe(Math.round(parsed.detectedClosingBalance!*100));
 });
 it("retains wrapped complements and treats a later SALDO INICIAL as a daily checkpoint", () => {
  const parsed=parseSafraStatement(clone());
  expect(parsed.transactions.at(-1)?.description).toContain("00000000000000");
  expect(parsed.transactions.filter(t=>t.date==="2026-10-15")).toHaveLength(2);
  expect(parsed.transactions.at(-1)?.balance).toBe(4694.24);
 });
 it("rejects incomplete amounts, missing final balances and foreign layouts", () => {
  const broken=clone();const row=broken.find(l=>l.text.includes("RENDIMENTO CDB"))!;row.parts.at(-1)!.text="0,0";
  expect(()=>parseSafraStatement(broken)).toThrow("Valor ilegível");
  const missing=clone();missing.splice(missing.findLastIndex(l=>l.text.includes("15/10 SALDO TOTAL")),1);
  expect(()=>parseSafraStatement(missing)).toThrow("saldo final");
  expect(()=>parseSafraStatement([])).toThrow("não corresponde");
 });
 it("uses the statement period to resolve December/January and rejects out-of-period movements", () => {
  const minimal=(period:string, dates:string[])=>[
    {page:1,y:800,text:"Banco Safra Extrato de Conta Corrente AG: 0001 | CONTA: 1-0 "+period,parts:[]},
    {page:1,y:700,text:"Data Lançamento Complemento Nº Documento Valor (R$)",parts:[{x:25,text:"Data"},{x:63,text:"Lançamento"},{x:244,text:"Complemento"},{x:412,text:"Nº Documento"},{x:534,text:"Valor (R$)"}]},
    ...dates.map((date,i)=>({page:1,y:680-i*16,text:date,parts:[{x:25,text:date},{x:63,text:i===0?"PIX RECEBIDO":"SALDO TOTAL"},...(i===0?[{x:412,text:"1"}]:[]),{x:530,text:"10,00"}]}))
  ];
  expect(parseSafraStatement(minimal("Período de 30/12/2026 a 02/01/2027",["01/01","01/01"])).transactions[0].date).toBe("2027-01-01");
  expect(()=>parseSafraStatement(minimal("Período de 01/01/2027 a 02/01/2027",["31/12","31/12"]))).toThrow("fora do período");
 });
 it("generates Safra OFX with signed transactions, original amounts and unique FITIDs", () => {
  const parsed=parseSafraStatement(clone());
  const ofx=generateOfx({bankId:"422",branch:parsed.branch,account:parsed.account,initialBalance:parsed.detectedOpeningBalance!,finalBalance:4694.23,transactions:parsed.transactions});
  expect(ofx).toContain("<BANKID>422</BANKID>");expect(ofx).toContain("<ORG>Banco Safra S.A.</ORG>");expect(ofx).toContain("<TRNAMT>-102000.00</TRNAMT>");
  expect(ofx.match(/<STMTTRN>/g)).toHaveLength(56);
  const ids=[...ofx.matchAll(/<FITID>(.*?)<\/FITID>/g)].map(m=>m[1]);expect(new Set(ids).size).toBe(56);
 });
});
