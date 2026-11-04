import {beforeEach,it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
const m=vi.hoisted(()=>({transaction:vi.fn(),jobs:vi.fn(),findSync:vi.fn(),upsert:vi.fn(),claim:vi.fn(),findConnection:vi.fn(),lockedConnection:vi.fn(),writeSync:vi.fn(),entries:vi.fn(),raw:vi.fn(),locked:vi.fn(),request:vi.fn()}));
vi.mock("@/lib/prisma",()=>({prisma:{$transaction:m.transaction,whatsAppDirectorySync:{findMany:m.jobs,updateMany:m.claim},whatsAppConnection:{findUnique:m.findConnection}}}));
vi.mock("@/modules/purchase-invoices/server/crypto",()=>({decryptIntegrationSecret:()=>"test-token"}));
vi.mock("./uazapi",async original=>({...await original<typeof import("./uazapi")>(),uazapiRequest:m.request}));
import {CURRENT_DIRECTORY_PREFIX} from "./directory-core";
import {scheduleDirectorySync,processDirectorySync} from "./directory";
import type {whatsappConnection} from "./uazapi-server";
const connection={id:"conn",organizationId:"org",phone:"5511888888888",instanceId:"inst",status:"CONNECTED",expiresAt:null,serverUrl:"https://fortunohub.uazapi.com",tokenEncrypted:"encrypted"} as NonNullable<Awaited<ReturnType<typeof whatsappConnection>>>;
const job={id:"job",connectionId:"conn",organizationId:"org",accountPhone:connection.phone,instanceId:"inst",generation:"generation",status:"PENDING",phase:"CONTACTS",offset:0,attempts:0,claimedAt:null};
beforeEach(()=>{vi.clearAllMocks();m.findSync.mockResolvedValue(null);m.jobs.mockResolvedValue([]);m.findConnection.mockResolvedValue(connection);m.lockedConnection.mockResolvedValue({id:"conn"});m.claim.mockResolvedValue({count:1});m.locked.mockResolvedValue([{id:"job"}]);m.upsert.mockImplementation(({create})=>Promise.resolve(create));m.transaction.mockImplementation(fn=>fn({$executeRaw:m.raw,$queryRaw:m.locked,whatsAppDirectorySync:{findUnique:m.findSync,upsert:m.upsert,update:m.writeSync},whatsAppDirectoryEntry:{updateMany:m.entries},whatsAppConnection:{findFirst:m.lockedConnection}}));});
it("schedules per connected phone and avoids restarting an active sync",async()=>{
 m.findSync.mockResolvedValueOnce({status:"PENDING",instanceId:"inst",generation:CURRENT_DIRECTORY_PREFIX+"active"});await scheduleDirectorySync(connection,true);expect(m.upsert).not.toHaveBeenCalled();
 await scheduleDirectorySync(connection);expect(m.upsert.mock.calls[0][0].where).toEqual({connectionId_accountPhone:{connectionId:"conn",accountPhone:connection.phone}});
});
it("does not fetch disconnected or expired accounts",async()=>{
 expect(await scheduleDirectorySync({...connection,status:"DISCONNECTED"})).toBeNull();expect(await scheduleDirectorySync({...connection,expiresAt:new Date(0)})).toBeNull();expect(m.transaction).not.toHaveBeenCalled();
});
it("keeps previous entries on provider failure",async()=>{
 m.jobs.mockResolvedValueOnce([job]);m.request.mockRejectedValue(new Error("Unavailable"));await processDirectorySync("conn");expect(m.entries).not.toHaveBeenCalled();expect(m.claim.mock.calls.at(-1)?.[0].data).toMatchObject({status:"FAILED"});
});
it("cancels stale work when a different phone connects before fetching",async()=>{
 m.jobs.mockResolvedValueOnce([job]);m.findConnection.mockResolvedValue({...connection,phone:"another-phone"});await processDirectorySync("conn");expect(m.request).not.toHaveBeenCalled();expect(m.claim.mock.calls.at(-1)?.[0].data.status).toBe("CANCELLED");
});
it("imports a page and only retires stale entries of the completed kind and exact account",async()=>{
 m.jobs.mockResolvedValueOnce([job]);m.request.mockResolvedValue({contacts:[{jid:"5511999999999@s.whatsapp.net",contact_name:"Contato"}],pagination:{hasMore:false,nextOffset:1}});await processDirectorySync("conn");
 expect(m.request.mock.calls[0]).toMatchObject([connection.serverUrl,"test-token","/contacts/list",{limit:200,offset:0,contactScope:"address_book"}]);
 expect(m.entries.mock.calls[0][0].where).toEqual({organizationId:"org",connectionId:"conn",accountPhone:connection.phone,kind:"CONTACT",generation:{not:"generation"}});
 expect(m.writeSync.mock.calls[0][0].data).toMatchObject({status:"PENDING",phase:"GROUPS",offset:0});
});
it("falls back only when a legacy server lacks the paged collection endpoint",async()=>{
 m.jobs.mockResolvedValueOnce([job]);m.request.mockRejectedValueOnce(Object.assign(new Error("Not found"),{status:404})).mockResolvedValueOnce([{jid:"5511999999999@s.whatsapp.net",contact_name:"Contato"}]);await processDirectorySync("conn");expect(m.request.mock.calls[1][2]).toBe("/contacts?contactScope=address_book");expect(m.writeSync).toHaveBeenCalled();
});

it("replaces an old all-contacts snapshot even when the prior job was pending",async()=>{m.findSync.mockResolvedValue({status:"PENDING",instanceId:"inst",generation:"legacy-all"});await scheduleDirectorySync(connection);expect(m.upsert).toHaveBeenCalledOnce();expect(m.upsert.mock.calls[0][0].create.generation).toMatch(/^address-book-v1:/);});
