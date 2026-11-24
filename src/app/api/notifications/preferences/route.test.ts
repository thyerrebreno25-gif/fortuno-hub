import {beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({user:vi.fn(),update:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getUser:m.user,updateUser:m.update}})}));
import {GET,PATCH} from "./route";
beforeEach(()=>{vi.resetAllMocks();m.user.mockResolvedValue({data:{user:{id:"me",user_metadata:{name:"Ana",fortuno_notifications_muted:true}}},error:null});m.update.mockResolvedValue({data:{user:{id:"me",user_metadata:{fortuno_notifications_muted:false}}},error:null});});
const patch=(body:unknown)=>PATCH(new Request("https://hub.test/api/notifications/preferences",{method:"PATCH",body:JSON.stringify(body)}));
it("reads the signed-in account preference without public caching",async()=>{const response=await GET();expect(await response.json()).toEqual({userId:"me",notificationsMuted:true});expect(response.headers.get("cache-control")).toBe("private, no-store");});
it("saves only the notification flag in the authenticated user's metadata",async()=>{const response=await patch({notificationsMuted:false});expect(response.status).toBe(200);expect(m.update).toHaveBeenCalledWith({data:{fortuno_notifications_muted:false}});expect(await response.json()).toEqual({userId:"me",notificationsMuted:false});});
it("denies anonymous changes and does not accept another user or extra metadata",async()=>{
 expect((await patch({notificationsMuted:false,userId:"another"})).status).toBe(400);expect((await patch({notificationsMuted:"true"})).status).toBe(400);expect(m.update).not.toHaveBeenCalled();
 m.user.mockResolvedValue({data:{user:null},error:new Error("token")});expect((await GET()).status).toBe(401);expect((await patch({notificationsMuted:true})).status).toBe(401);expect(m.update).not.toHaveBeenCalled();
});
it("does not claim a saved preference after an auth service failure",async()=>{m.update.mockResolvedValue({data:{user:null},error:{message:"sensitive provider failure"}});const response=await patch({notificationsMuted:true});expect(response.status).toBe(502);expect(JSON.stringify(await response.json())).not.toContain("sensitive provider");});
it("defaults accounts without a preference to enabled notifications",async()=>{m.user.mockResolvedValue({data:{user:{id:"new",user_metadata:{}}},error:null});expect(await(await GET()).json()).toEqual({userId:"new",notificationsMuted:false});});
