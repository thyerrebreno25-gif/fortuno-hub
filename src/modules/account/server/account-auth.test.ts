import {beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({user:vi.fn(),member:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getUser:m.user}})}));
vi.mock("@/lib/prisma",()=>({prisma:{organizationMember:{findFirst:m.member}}}));
import {getAccountMember} from "./account-auth";
beforeEach(()=>{vi.clearAllMocks();m.member.mockResolvedValue({id:"membership",userId:"me",organizationId:"org",role:"OPERATOR"});m.user.mockResolvedValue({data:{user:{id:"me",user_metadata:{fortuno_notifications_muted:true,role:"MASTER"}}},error:null});});
it("reads the personal notification flag while retaining the database role and organization",async()=>{expect(await getAccountMember()).toMatchObject({notificationsMuted:true,role:"OPERATOR",organizationId:"org"});expect(m.member.mock.calls[0][0].where).toEqual({userId:"me"});});
it("defaults an unset preference to enabled and rejects unauthenticated access",async()=>{m.user.mockResolvedValueOnce({data:{user:{id:"me",user_metadata:{}}},error:null});expect((await getAccountMember())?.notificationsMuted).toBe(false);m.member.mockClear();m.user.mockResolvedValueOnce({data:{user:null},error:new Error("auth")});expect(await getAccountMember()).toBeNull();expect(m.member).not.toHaveBeenCalled();});
