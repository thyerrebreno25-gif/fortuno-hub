import {describe,it,expect} from "vitest";
import {CURRENT_DIRECTORY_PREFIX,currentDirectoryVisibility,directoryPage} from "./directory-core";
describe("WhatsApp directory independent from messages",()=>{
 it("imports contacts without messages and preserves names",()=>{
  const page=directoryPage({contacts:[{jid:"5511999999999@s.whatsapp.net",contact_name:"Cliente A"},{jid:"123@lid",contact_FirstName:"Cliente B"}],pagination:{hasMore:false}},"CONTACT",0);
  expect(page.entries).toEqual([{externalId:"5511999999999@s.whatsapp.net",kind:"CONTACT",displayName:"Cliente A"},{externalId:"123@lid",kind:"CONTACT",displayName:"Cliente B"}]);expect(page.hasMore).toBe(false);
 });
 it("imports group names without members or messages and excludes broadcasts",()=>{
  expect(directoryPage({groups:[{JID:"120363001@g.us",Name:"Grupo do cliente"},{JID:"status@broadcast",Name:"Status"}]},"GROUP",0).entries).toEqual([{externalId:"120363001@g.us",kind:"GROUP",displayName:"Grupo do cliente"}]);
 });
 it("follows pagination beyond the first 200, retains stable identities and rejects non advancing cursors",()=>{
  const row={jid:"5511999999999@s.whatsapp.net",contact_name:"Cliente"};
  expect(directoryPage({contacts:[row,row],pagination:{hasMore:true,nextOffset:400}},"CONTACT",200)).toMatchObject({entries:[{externalId:row.jid}],hasMore:true,nextOffset:400});
  expect(()=>directoryPage({contacts:[row],pagination:{hasMore:true,nextOffset:200}},"CONTACT",200)).toThrow("não avançou");
 });
 it("does not erase a prior directory on an unexpected or invalid provider response",()=>{
  expect(()=>directoryPage({error:"unavailable"},"CONTACT",0)).toThrow("inválida");
  expect(()=>directoryPage({contacts:[{jid:"invalid"}]},"CONTACT",0)).toThrow("identificadores válidos");
 });
 it("supports the official legacy collection format",()=>{
  expect(directoryPage([{jid:"5511999999999@s.whatsapp.net",contact_name:"Nome"}],"CONTACT",0,true)).toMatchObject({hasMore:false});
 });
});

it("hides contact snapshots created with the previous broad scope while retaining groups",()=>{expect(currentDirectoryVisibility()).toEqual({OR:[{kind:"GROUP"},{kind:"CONTACT",generation:{startsWith:CURRENT_DIRECTORY_PREFIX}}]});});
