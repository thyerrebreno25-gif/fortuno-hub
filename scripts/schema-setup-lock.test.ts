import {beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({query:vi.fn(),connect:vi.fn(),end:vi.fn(),read:vi.fn(),schedule:vi.fn()}));
vi.mock("dotenv/config",()=>({}));
vi.mock("node:fs/promises",()=>({readFile:m.read}));
vi.mock("pg",()=>({default:{Client:class{connect=m.connect;query=m.query;end=m.end;}}}));
vi.mock("./setup-management-schedule.mjs",()=>({setupManagementSchedule:m.schedule}));
beforeEach(()=>{vi.resetModules();vi.clearAllMocks();vi.stubEnv("DIRECT_URL","postgresql://unit:unit@127.0.0.1/unused");m.query.mockResolvedValue({rows:[]});m.read.mockResolvedValue("SELECT 1;");});
it.each(["ensure-notion","ensure-operational-mapping","ensure-meetings-calendar","ensure-management"])("%s locks shared schema before module DDL, without a real database",async name=>{
 await import(`./${name}.mjs`);
 const queries=m.query.mock.calls.map(call=>call[0]);
 const global=queries.indexOf("SELECT pg_advisory_xact_lock(hashtext('fortuno-schema-setup-global-v1'))");
 expect(global).toBeGreaterThan(queries.indexOf("BEGIN"));
 expect(global).toBeLessThan(queries.indexOf("SELECT 1;"));
 expect(queries.filter(query=>typeof query==="string"&&query.includes("pg_advisory_xact_lock"))).toHaveLength(2);
 expect(queries).toContain("COMMIT");expect(m.end).toHaveBeenCalledOnce();
});
