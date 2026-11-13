vi.mock("@/modules/meetings/reports",()=>({publicReportSelect:{},processMeetingReport:vi.fn()}));
import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({access:vi.fn(),trash:vi.fn(),save:vi.fn(),after:vi.fn(),members:vi.fn(),connections:vi.fn(),connection:vi.fn()}));
vi.mock('next/server',async()=>{const actual=await vi.importActual<typeof import('next/server')>('next/server');return {...actual,after:m.after};});
vi.mock('@/lib/prisma',()=>({prisma:{organizationMember:{findMany:m.members},googleCalendarConnection:{findMany:m.connections,findUnique:m.connection}}}));
vi.mock('@/modules/meetings/auth',()=>({meetingAccess:m.access,meetingFailure:(error:{status?:number;message?:string})=>Response.json({error:error.message},{status:error.status||400}),meetingScope:vi.fn(),findMeeting:vi.fn()}));
vi.mock('@/modules/meetings/service',()=>({saveMeeting:m.save,trashMeeting:m.trash}));
vi.mock('@/modules/meetings/delivery',()=>({processMeetingBackground:vi.fn()}));
vi.mock('@/modules/meetings/google-calendar',()=>({googleConfigured:vi.fn()}));
import {DELETE,PATCH,GET,POST} from './route';
beforeEach(()=>{vi.clearAllMocks();m.access.mockResolvedValue({member:{organizationId:'org',userId:'owner'}});m.trash.mockResolvedValue({ok:true});});
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
