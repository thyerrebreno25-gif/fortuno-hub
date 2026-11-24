import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const request = vi.hoisted(() => vi.fn());
vi.mock("@/modules/purchase-invoices/server/conta-azul", () => ({ contaAzulRequest: request }));
import { resolveAcquirerContact } from "./acquirer-contact";
beforeEach(() => { vi.useFakeTimers(); vi.resetAllMocks(); request.mockImplementation(async (_client, path, init) => init?.method === 'POST' ? { id: 'new', nome: 'Cielo', documento: '01027058000191' } : path.includes('?') ? { items: [{ id: 'existing', nome: 'Cielo', documento: '01027058000191' }], totalItems: 1 } : { id: 'existing', nome: 'Cielo', documento: '01027058000191', ativo: true, perfis: ['Fornecedor', 'Cliente'] }); });
afterEach(() => vi.useRealTimers());
async function finish<T>(promise: Promise<T>): Promise<T> {
 const outcome = promise.then(value => ({ value }), error => ({ error }));
 await vi.runAllTimersAsync();
 const result = await outcome;
 if ('error' in result) throw result.error;
 return result.value;
}
it("reuses the acquirer itself as supplier and customer without posting a duplicate", async () => { expect(await resolveAcquirerContact('client', 'PAYABLE', 'Cielo')).toEqual({ value: 'existing', label: 'Cielo' }); expect(await resolveAcquirerContact('client', 'RECEIVABLE', 'Cielo')).toEqual({ value: 'existing', label: 'Cielo' }); expect(request.mock.calls.some(call => call[2]?.method === 'POST')).toBe(false); expect(request.mock.calls.every(call => call[0] === 'client')).toBe(true); });
it("creates a missing acquirer with supplier and customer profiles", async () => { request.mockImplementation(async (_client, path, init) => init?.method === 'POST' ? { id: 'new', nome: 'Cielo', documento: '01027058000191' } : { totalItems: 0 }); await resolveAcquirerContact('client', 'PAYABLE', 'Cielo'); const post = request.mock.calls.find(call => call[2]?.method === 'POST')!; expect(JSON.parse(post[2].body)).toMatchObject({ nome: 'Cielo', cnpj: '01027058000191', perfis: [{ tipo_perfil: 'Fornecedor' }, { tipo_perfil: 'Cliente' }] }); });
it("does not create when lookup is invalid or ambiguous", async () => { request.mockResolvedValueOnce({ unexpected: [] }); await expect(resolveAcquirerContact('client', 'PAYABLE', 'Cielo')).rejects.toThrow('busca'); expect(request.mock.calls.some(call => call[2]?.method === 'POST')).toBe(false); request.mockResolvedValue({ items: [{ id: 'a', nome: 'Cielo', documento: '01027058000191' }, { id: 'b', nome: 'Cielo', documento: '01027058000191' }], totalItems: 2 }); await expect(resolveAcquirerContact('client', 'PAYABLE', 'Cielo')).rejects.toThrow('mais de um'); });
it("adds the missing required profile to the same person and preserves existing profiles",async()=>{
 let profiles=['Cliente','Transportadora'];request.mockImplementation(async(_client,path,init)=>{if(init?.method==='PATCH'){profiles=JSON.parse(init.body).perfis.map((p:{tipo_perfil:string})=>p.tipo_perfil);return {};}return path.includes('?')?{items:[{id:'existing',nome:'Cielo',documento:'01027058000191'}]}:{id:'existing',nome:'Cielo',documento:'01027058000191',ativo:true,perfis:profiles};});
 expect(await resolveAcquirerContact('client','PAYABLE','Cielo')).toEqual({value:'existing',label:'Cielo'});expect(profiles).toEqual(['Cliente','Transportadora','Fornecedor']);const patch=request.mock.calls.find(call=>call[2]?.method==='PATCH')!;expect(patch[1]).toBe('/v1/pessoas/existing');expect(Object.keys(JSON.parse(patch[2].body)).sort()).toEqual(['cnpj','perfis','tipo_pessoa']);expect(request.mock.calls.some(call=>call[2]?.method==='POST')).toBe(false);
});
it("rejects an unidentified or generic acquirer", async () => { await expect(resolveAcquirerContact('client', 'PAYABLE', null)).rejects.toThrow('Identifique'); await expect(resolveAcquirerContact('client', 'PAYABLE', 'LANÇAMENTO AUTOMÁTICO')).rejects.toThrow('Identifique'); expect(request).not.toHaveBeenCalled(); });

it("never creates multiple profiles for an unidentified corporate document",async()=>{request.mockImplementation(async(_client,path,init)=>init?.method==='POST'?{id:'new',nome:'Outra'}:{totalItems:0});await resolveAcquirerContact('client','PAYABLE','Outra');const post=request.mock.calls.find(call=>call[2]?.method==='POST')!;expect(JSON.parse(post[2].body).perfis).toEqual([{tipo_perfil:'Fornecedor'}]);});

it("accepts the documented creation response containing only an ID",async()=>{const id="00000000-0000-4000-8000-000000000001";request.mockImplementation(async(_client,path,init)=>init?.method==="POST"?{id}:{totalItems:0});expect(await resolveAcquirerContact("client","PAYABLE","Cielo")).toEqual({value:id,label:"Cielo"});});

it("verifies profile updates before sending and never creates a duplicate on failed confirmation",async()=>{
 request.mockImplementation(async(_client,path,init)=>init?.method==='PATCH'?{}:path.includes('?')?{items:[{id:'existing',nome:'Rede'}]}:{id:'existing',nome:'Rede',documento:'01425787000104',ativo:true,perfis:['Cliente']});await expect(finish(resolveAcquirerContact('another-client','PAYABLE','Rede'))).rejects.toThrow('não confirmou');expect(request.mock.calls.every(call=>call[0]==='another-client')).toBe(true);expect(request.mock.calls.some(call=>call[2]?.method==='POST')).toBe(false);
});
it("reuses a known ID with a missing profile without searching or overwriting corporate data",async()=>{
 let updated=false;request.mockImplementation(async(_client,_path,init)=>{if(init?.method==='PATCH'){updated=true;return {};}return {id:'known',nome:'Getnet',documento:'10440482000154',ativo:true,perfis:updated?['Cliente','Fornecedor']:['Cliente']};});expect(await resolveAcquirerContact('client','PAYABLE','Getnet','known')).toEqual({value:'known',label:'Getnet'});expect(request.mock.calls.some(call=>call[1].includes('?'))).toBe(false);
});

it.each(['REDE','Redecard','Redecard Instituição de Pagamento S.A.'])("creates %s with verified identity and both financial profiles in one registration", async label => {
 request.mockImplementation(async (_client,_path,init) => init?.method === 'POST' ? {id:'00000000-0000-4000-8000-000000000001'} : {totalItems:0});
 await resolveAcquirerContact('beef','RECEIVABLE',label);
 const posts=request.mock.calls.filter(call=>call[2]?.method==='POST');expect(posts).toHaveLength(1);
 expect(JSON.parse(posts[0][2].body)).toMatchObject({cnpj:'01425787000104',tipo_pessoa:'Jurídica',perfis:[{tipo_perfil:'Fornecedor'},{tipo_perfil:'Cliente'}]});
});

it.each(['beef','another-client'])("repairs the legacy documentless Rede person in %s without replacing other registration data", async clientId => {
 let person:Record<string,unknown>={id:'rede',nome:'REDE',ativo:true,tipo_pessoa:'JURIDICA',perfis:[{tipo_perfil:'Cliente'},{tipo_perfil:'Transportadora'}],email:'fixture@example.test',enderecos:[{id:'address',logradouro:'preserved'}]};
 request.mockImplementation(async (_client,path,init)=>{if(init?.method==='PATCH'){const patch=JSON.parse(init.body);person={...person,documento:patch.cnpj,perfis:patch.perfis};return {};}return path.includes('?')?{items:[{id:'rede',nome:'REDE'}],totalItems:1}:person;});
 expect(await resolveAcquirerContact(clientId,'PAYABLE','REDE')).toEqual({value:'rede',label:'REDE'});
 const patches=request.mock.calls.filter(call=>call[2]?.method==='PATCH');expect(patches).toHaveLength(1);
 expect(JSON.parse(patches[0][2].body)).toEqual({cnpj:'01425787000104',tipo_pessoa:'Jurídica',perfis:[{tipo_perfil:'Cliente'},{tipo_perfil:'Transportadora'},{tipo_perfil:'Fornecedor'}]});
 expect(person.email).toBe('fixture@example.test');expect(person.enderecos).toEqual([{id:'address',logradouro:'preserved'}]);
 expect(request.mock.calls.every(call=>call[0]===clientId)).toBe(true);expect(request.mock.calls.some(call=>call[2]?.method==='POST'||call[2]?.method==='PUT')).toBe(false);
});

it.each([500,504])("reconciles an applied profile after HTTP %s instead of repeating the update",async status=>{
 let applied=false;request.mockImplementation(async(_client,_path,init)=>{if(init?.method==='PATCH'){applied=true;throw Object.assign(Error('Ocorreu um erro ao tentar atualizar parcialmente a pessoa'),{status});}return {id:'known',nome:'REDE',ativo:true,documento:applied?'01425787000104':'',perfis:applied?['Cliente','Fornecedor']:['Cliente']};});
 expect(await resolveAcquirerContact('beef','PAYABLE','REDE','known')).toEqual({value:'known',label:'REDE'});
 expect(request.mock.calls.filter(call=>call[2]?.method==='PATCH')).toHaveLength(1);expect(request.mock.calls.some(call=>call[2]?.method==='POST')).toBe(false);
});

it("retries a temporary rejection only after re-reading the same person and preserves newly added profiles",async()=>{
 let attempts=0;request.mockImplementation(async(_client,_path,init)=>{if(init?.method==='PATCH'){attempts++;if(attempts===1)throw Object.assign(Error('temporary'),{status:503});return {};}return {id:'known',nome:'REDE',ativo:true,documento:'01425787000104',perfis:attempts>=2?['Cliente','Transportadora','Fornecedor']:attempts?['Cliente','Transportadora']:['Cliente']};});
 expect(await finish(resolveAcquirerContact('beef','PAYABLE','REDE','known'))).toEqual({value:'known',label:'REDE'});
 const calls=request.mock.calls,patches=calls.filter(call=>call[2]?.method==='PATCH');expect(patches).toHaveLength(2);
 expect(JSON.parse(patches[1][2].body).perfis).toEqual([{tipo_perfil:'Cliente'},{tipo_perfil:'Transportadora'},{tipo_perfil:'Fornecedor'}]);
 expect(calls.slice(calls.indexOf(patches[0])+1,calls.indexOf(patches[1])).every(call=>call[1]==='/v1/pessoas/known'&&!call[2]?.method)).toBe(true);
});

it("bounds persistent provider errors and never starts a duplicate creation",async()=>{
 request.mockImplementation(async(_client,_path,init)=>{if(init?.method==='PATCH')throw Object.assign(Error('provider down'),{status:500});return {id:'known',nome:'REDE',ativo:true,documento:'01425787000104',perfis:['Cliente']};});
 await expect(finish(resolveAcquirerContact('beef','PAYABLE','REDE','known'))).rejects.toThrow('não confirmou');
 expect(request.mock.calls.filter(call=>call[2]?.method==='PATCH')).toHaveLength(3);expect(request.mock.calls.some(call=>call[2]?.method==='POST'||call[2]?.method==='PUT')).toBe(false);
});

it.each([400,403,422,429])("does not retry rejected/unauthorized/rate-limited profile writes (%s)",async status=>{
 request.mockImplementation(async(_client,_path,init)=>{if(init?.method==='PATCH')throw Object.assign(Error('rejected'),{status});return {id:'known',nome:'REDE',ativo:true,documento:'01425787000104',perfis:['Cliente']};});
 await expect(finish(resolveAcquirerContact('beef','PAYABLE','REDE','known'))).rejects.toThrow('não confirmou');expect(request.mock.calls.filter(call=>call[2]?.method==='PATCH')).toHaveLength(1);
});

it("keeps a known legal name/branch CNPJ instead of searching or overwriting it",async()=>{
 let updated=false;request.mockImplementation(async(_client,_path,init)=>{if(init?.method==='PATCH'){updated=true;expect(JSON.parse(init.body).cnpj).toBe('01425787000295');return {};}return {id:'known',nome:'Redecard Instituição de Pagamento S.A.',ativo:true,documento:'01425787000295',perfis:updated?['Cliente','Fornecedor']:['Cliente']};});
 expect(await resolveAcquirerContact('client','PAYABLE','REDE','known')).toEqual({value:'known',label:'Redecard Instituição de Pagamento S.A.'});expect(request.mock.calls.some(call=>call[1].includes('?'))).toBe(false);
});

it("refuses an unverified identity instead of inventing a CNPJ or duplicating the person",async()=>{
 request.mockResolvedValue({id:'known',nome:'Outra',ativo:true,perfis:['Cliente']});await expect(resolveAcquirerContact('client','PAYABLE','Outra','known')).rejects.toThrow('precisa de CPF/CNPJ');expect(request).toHaveBeenCalledOnce();
});

it.each(['00000000000191','12345678901'])("refuses a conflicting existing document %s even if the profile is already present",async documento=>{
 request.mockResolvedValue({id:'known',nome:'REDE',ativo:true,documento,perfis:['Cliente','Fornecedor']});await expect(resolveAcquirerContact('client','PAYABLE','REDE','known')).rejects.toThrow('outro CNPJ');expect(request).toHaveBeenCalledOnce();
});

it("stops when the confirmation read fails, without repeating a possibly applied write",async()=>{
 let patched=false;request.mockImplementation(async(_client,_path,init)=>{if(init?.method==='PATCH'){patched=true;throw Object.assign(Error('timeout'),{status:504});}if(patched)throw Error('read unavailable');return {id:'known',nome:'REDE',ativo:true,perfis:['Cliente']};});
 await expect(resolveAcquirerContact('beef','PAYABLE','REDE','known')).rejects.toThrow('read unavailable');expect(request.mock.calls.filter(call=>call[2]?.method==='PATCH')).toHaveLength(1);
});

it.each(['FISICA','ESTRANGEIRA','unknown'])("does not change the existing incompatible person type %s to fill a known CNPJ",async tipo_pessoa=>{
 request.mockResolvedValue({id:'known',nome:'REDE',ativo:true,tipo_pessoa,perfis:['Cliente']});await expect(resolveAcquirerContact('beef','PAYABLE','REDE','known')).rejects.toThrow('tipo de pessoa');expect(request).toHaveBeenCalledOnce();
});

it("supports an existing CPF or alphanumeric CNPJ without guessing a corporate identity",async()=>{
 for(const documento of ['12345678901','12ABC34501DE35']){
  let updated=false;request.mockImplementation(async(_client,_path,init)=>{if(init?.method==='PATCH'){updated=true;const payload=JSON.parse(init.body);expect(payload[documento.length===11?'cpf':'cnpj']).toBe(documento);return {};}return {id:'known',nome:'Outra',ativo:true,documento,perfis:updated?['Cliente','Fornecedor']:['Cliente']};});
  expect(await resolveAcquirerContact('client','PAYABLE','Outra','known')).toEqual({value:'known',label:'Outra'});
 }
});

it("does not overwrite a concurrent profile removal after an uncertain update",async()=>{
 let patched=false;request.mockImplementation(async(_client,_path,init)=>{if(init?.method==='PATCH'){patched=true;throw Object.assign(Error('timeout'),{status:504});}return {id:'known',nome:'REDE',ativo:true,documento:'01425787000104',perfis:patched?['Cliente']:['Cliente','Transportadora']};});
 await expect(resolveAcquirerContact('beef','PAYABLE','REDE','known')).rejects.toThrow('mudou durante');expect(request.mock.calls.filter(call=>call[2]?.method==='PATCH')).toHaveLength(1);
});
