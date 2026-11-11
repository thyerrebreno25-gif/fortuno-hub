import {beforeEach,it,expect,vi} from "vitest";
const m=vi.hoisted(()=>({member:vi.fn(),perms:vi.fn(),snapshot:vi.fn(),cache:vi.fn()}));
vi.mock("@/modules/permissions/permissions",()=>({getCurrentMember:m.member,getRolePermissions:m.perms}));
vi.mock("@/modules/usage/server",()=>({usageSnapshot:m.snapshot}));
vi.mock("next/cache",()=>({unstable_cache:(fn:()=>unknown,keys:unknown)=>{m.cache(keys);return fn;}}));
import {GET} from "./route";
beforeEach(()=>{vi.clearAllMocks();m.member.mockResolvedValue({userId:"manager",organizationId:"tenant",role:"MANAGER"});m.perms.mockResolvedValue({MANAGEMENT:{canView:true},CLIENTS:{canView:true},IMPORTS:{canView:true}});m.snapshot.mockResolvedValue({ok:true});});
it("allows only management roles with module access",async()=>{m.member.mockResolvedValueOnce(null);expect((await GET(new Request("https://hub.test/api/management/usage"))).status).toBe(401);m.member.mockResolvedValueOnce({role:"OPERATOR",organizationId:"tenant"});expect((await GET(new Request("https://hub.test/api/management/usage"))).status).toBe(403);expect(m.snapshot).not.toHaveBeenCalled();});
it("rejects invalid dates before querying and passes tenant/module-scoped filters into a private cache",async()=>{expect((await GET(new Request("https://hub.test/api/management/usage?from=oops"))).status).toBe(400);expect(m.snapshot).not.toHaveBeenCalled();const response=await GET(new Request("https://hub.test/api/management/usage?userId=operator"));expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("private, no-store");expect(m.snapshot.mock.calls[0][0]).toBe("tenant");expect(m.snapshot.mock.calls[0][3]).toEqual({userId:"operator"});expect(m.cache.mock.calls[0][0]).toContain("tenant");});
