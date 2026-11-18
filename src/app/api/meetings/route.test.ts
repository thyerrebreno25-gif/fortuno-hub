vi.mock("@/modules/meetings/reports",()=>({publicReportSelect:{},processMeetingReport:vi.fn()}));
import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({access:vi.fn(),trash:vi.fn(),save:vi.fn(),after:vi.fn(),members:vi.fn(),connections:vi.fn(),connection:vi.fn(),list:vi.fn(),detail:vi.fn(),findAccess:vi.fn(),carry:vi.fn(),counts:vi.fn(),daily:vi.fn()}));
vi.mock('next/server',async()=>{const actual=await vi.importActual<typeof import('next/server')>('next/server');return {...actual,after:m.after};});
vi.mock('@/lib/prisma',()=>({prisma:{teamMeeting:{findMany:m.list,findFirstOrThrow:m.detail},teamCalendarEvent:{findFirst:vi.fn(async()=>null),findMany:vi.fn(async()=>[])},organizationMember:{findMany:m.members},googleCalendarConnection:{findMany:m.connections,findUnique:m.connection}}}));
vi.mock('@/modules/meetings/auth',()=>({meetingAccess:m.access,meetingFailure:(error:{status?:number;message?:string})=>Response.json({error:error.message},{status:error.status||400}),meetingScope:vi.fn(),findMeeting:m.findAccess}));
vi.mock('@/modules/meetings/service',()=>({saveMeeting:m.save,trashMeeting:m.trash}));
vi.mock('@/modules/meetings/delivery',()=>({processMeetingBackground:vi.fn()}));
vi.mock('@/modules/meetings/google-calendar',()=>({googleConfigured:vi.fn()}));
vi.mock('@/modules/meetings/daily-carryover',()=>({dailyCarryoverActions:m.carry,dailyCarryoverCounts:m.counts}));
vi.mock('@/modules/meetings/daily-server',()=>({processDailyActivities:m.daily}));
import {DELETE,PATCH,GET,POST} from './route';
import {reportFingerprint} from '@/modules/meetings/report-model';
import {meetingScope} from '@/modules/meetings/auth';
beforeEach(()=>{vi.clearAllMocks();m.carry.mockResolvedValue({actions:[],total:0});m.counts.mockResolvedValue(new Map());m.connections.mockResolvedValue([]);m.access.mockResolvedValue({member:{organizationId:'org',userId:'owner'}});m.trash.mockResolvedValue({ok:true});});
it('applies filters before pagination and retains access scope for all meetings',async()=>{
 vi.mocked(meetingScope).mockReturnValue({organizationId:'org',deletedAt:null,OR:[{createdById:'owner'}]});m.list.mockResolvedValue([]);
 expect((await GET(new Request('https://hub.test/api/meetings?scope=all&period=nextMonth&q=Daily'))).status).toBe(200);
 const query=m.list.mock.calls[0][0];expect(query.where.AND[0]).toMatchObject({organizationId:'org',OR:[{createdById:'owner'}]});expect(query.where.AND[1]).toEqual({});expect(query.orderBy).toEqual([{startsAt:'asc'},{id:'asc'}]);expect(query.take).toBe(51);expect(query.where.OR).toHaveLength(2);
});
it('rejects impossible custom dates without loading meetings',async()=>{
 expect((await GET(new Request('https://hub.test/api/meetings?period=custom&from=2026-02-30&to=2026-03-02'))).status).toBe(400);expect(m.list).not.toHaveBeenCalled();
});
it('requires deletion permission and a valid revision before changing a meeting',async()=>{const response=await DELETE(new Request('https://hub.test/api/meetings',{method:'DELETE',body:JSON.stringify({id:'meeting',revision:3})}));expect(response.status).toBe(200);expect(m.access).toHaveBeenCalledWith('MEETINGS','canDelete');expect(m.trash).toHaveBeenCalledWith({organizationId:'org',userId:'owner'},'meeting',3);expect(m.after).toHaveBeenCalledTimes(1);});
it('rejects missing revisions and forbidden profiles without cancelling calendars',async()=>{expect((await DELETE(new Request('https://hub.test/api/meetings',{method:'DELETE',body:JSON.stringify({id:'meeting'})}))).status).toBe(400);expect(m.trash).not.toHaveBeenCalled();m.access.mockRejectedValue({status:403,message:'Sem permissão'});expect((await DELETE(new Request('https://hub.test/api/meetings',{method:'DELETE',body:'{}'}))).status).toBe(403);});
it('uses the recovery path and the same permission checks when restoring',async()=>{const response=await PATCH(new Request('https://hub.test/api/meetings?id=meeting',{method:'PATCH',body:JSON.stringify({action:'restore',revision:4})}));expect(response.status).toBe(200);expect(m.access).toHaveBeenCalledWith('MEETINGS','canDelete');expect(m.trash).toHaveBeenCalledWith({organizationId:'org',userId:'owner'},'meeting',4,true);expect(m.save).not.toHaveBeenCalled();});

it('exposes responsibility delegation and connected calendars to the Master without exposing credentials',async()=>{
 m.access.mockResolvedValue({member:{organizationId:'org',userId:'master',role:'MASTER'},permissions:{canCreate:true}});
 m.members.mockResolvedValue([{user:{id:'operator',name:'Operador',email:'operator@example.test'}}]);m.connections.mockResolvedValue([{userId:'operator'}]);m.connection.mockResolvedValue(null);
 const response=await GET(new Request('https://hub.test/api/meetings?view=options'));const body=await response.json();
 expect(body).toMatchObject({canAssignResponsible:true,connectedUserIds:['operator'],members:[{id:'operator'}]});
 expect(m.connections).toHaveBeenCalledWith({where:{organizationId:'org',status:'CONNECTED'},select:{userId:true}});
});
it('returns the number of independent occurrences created and queues the background synchronization',async()=>{
 m.save.mockResolvedValue({id:'first',createdCount:4});
 const response=await POST(new Request('https://hub.test/api/meetings',{method:'POST',body:JSON.stringify({title:'Reunião'})}));
 expect(response.status).toBe(201);expect(await response.json()).toMatchObject({meeting:{id:'first'},createdCount:4});expect(m.access).toHaveBeenCalledWith('MEETINGS','canCreate');expect(m.after).toHaveBeenCalledTimes(1);
});

it('loads previous Daily actions as references while preserving current occurrence actions and running the existing one-time deadline processor',async()=>{
 m.findAccess.mockResolvedValue({id:'today',type:'Daily'});const action={id:'task-original',meetingId:'yesterday',origin:{id:'yesterday'}};m.carry.mockResolvedValue({actions:[action],total:1});m.detail.mockResolvedValue({id:'today',type:'Daily',createdById:'owner',participants:[],actions:[],report:null});
 const response=await GET(new Request('https://hub.test/api/meetings?id=today'));expect(response.status).toBe(200);expect(await response.json()).toMatchObject({meeting:{id:'today',actions:[],carryoverActions:[action],carryoverTotal:1},canManage:true});expect(m.daily).toHaveBeenCalledWith('org');expect(m.carry).toHaveBeenCalledWith(expect.objectContaining({id:'today'}));
});
it('does not attach carried activities or process deadlines for a deleted occurrence',async()=>{
 m.findAccess.mockResolvedValue({id:'today',type:'Daily'});m.detail.mockResolvedValue({id:'today',type:'Daily',createdById:'owner',participants:[],actions:[],report:null});const response=await GET(new Request('https://hub.test/api/meetings?id=today&deleted=1'));expect(response.status).toBe(200);expect(m.daily).not.toHaveBeenCalled();expect(m.carry).not.toHaveBeenCalled();
});
it('includes distinct previous pending counts in the meeting list without changing native delivery totals',async()=>{
 m.list.mockResolvedValue([{id:'today',_count:{actions:0},actions:[]}]);m.counts.mockResolvedValue(new Map([['today',6]]));const response=await GET(new Request('https://hub.test/api/meetings?scope=all'));expect(response.status).toBe(200);expect(await response.json()).toMatchObject({meetings:[{id:'today',carryoverPending:6,_count:{actions:0},actions:[]}]});
});

it('detects old reports missing inherited actions and compares regenerated reports against the same complete source',async()=>{
 const meeting={id:'today',type:'Daily',title:'Daily',createdById:'owner',startsAt:'2026-11-18T12:00:00Z',endsAt:'2026-11-18T12:30:00Z',agenda:'',notes:'',status:'COMPLETED',participants:[],actions:[],contributions:[],recordings:[]};const carry={id:'prior-task',title:'Anterior',description:'',dueAt:'2026-11-18T18:00:00Z',completedAt:null,responsible:{name:'Equipe',email:'team@example.test'},origin:{id:'yesterday',title:'Daily',startsAt:'2026-11-17T12:00:00Z'}};
 m.findAccess.mockResolvedValue({id:'today',type:'Daily'});m.carry.mockResolvedValue({actions:[carry],total:1});m.detail.mockResolvedValue({...meeting,report:{content:'Versão anterior',includeRecordings:false,sourceHash:reportFingerprint(meeting,false)}});
 expect(await (await GET(new Request('https://hub.test/api/meetings?id=today'))).json()).toMatchObject({meeting:{report:{outdated:true}}});
 m.detail.mockResolvedValue({...meeting,report:{content:'Versão atual',includeRecordings:false,sourceHash:reportFingerprint({...meeting,carryoverActions:[carry]},false)}});
 expect(await (await GET(new Request('https://hub.test/api/meetings?id=today'))).json()).toMatchObject({meeting:{report:{outdated:false}}});
});
