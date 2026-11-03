import { expect, it, vi } from "vitest";
vi.mock('server-only',()=>({}));
const m=vi.hoisted(()=>({count:vi.fn().mockResolvedValue(0),remove:vi.fn().mockResolvedValue({count:0})}));
vi.mock('@/lib/prisma',()=>({prisma:{serviceTicket:{count:m.count,deleteMany:m.remove}}}));
import { purgeExpiredServiceTickets } from './retention';
it('never applies email retention rules to WhatsApp conversations',async()=>{await purgeExpiredServiceTickets(new Date('2026-11-03T12:00:00Z'));for(const mock of [m.count,m.remove])for(const [query] of mock.mock.calls)expect(query.where.source).toEqual({in:['GMAIL','MANUAL']});});
