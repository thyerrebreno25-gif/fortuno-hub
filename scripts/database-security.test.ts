import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { assertFortunoDatabase, securePublicTables } from "./database-security.mjs";

const sql = await readFile(new URL("./sql/secure-public-tables.sql", import.meta.url), "utf8");
const runtimeClient = { query: vi.fn() };
const adminClient = { query: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  runtimeClient.query.mockResolvedValue({ rows: [{ role: "hub_owner", database: "postgres" }] });
  adminClient.query.mockImplementation(async (query: string) => {
    if (query === "SELECT current_database() AS database") return { rows: [{ database: "postgres" }] };
    if (query.includes("AS protected_tables")) return { rows: [{ protected_tables: 105, unsafe_tables: 0 }] };
    return { rows: [] };
  });
});

describe("Fortuno-only database target", () => {
  it.each([
    "postgresql://user:example@db.npytozgtmrskpqessnyj.supabase.co/postgres",
    "postgres://postgres.npytozgtmrskpqessnyj:example@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
  ])("accepts the authorized project through direct or pooled connections", (url) => {
    expect(() => assertFortunoDatabase(url)).not.toThrow();
  });
  it.each([
    "postgresql://user:example@db.anotherproject.supabase.co/postgres",
    "postgresql://postgres.anotherproject:example@aws-0-us-east-1.pooler.supabase.com/postgres",
    "postgresql://postgres.npytozgtmrskpqessnyj:example@untrusted.example/postgres",
    "https://user:example@db.npytozgtmrskpqessnyj.supabase.co/postgres",
    "not a URL",
  ])("refuses another project without exposing connection details", (url) => {
    expect(() => assertFortunoDatabase(url)).toThrow(/^SECURITY_(PROJECT_MISMATCH|DATABASE_URL_INVALID)$/);
  });
});

it("uses the actual runtime identity, locks before DDL, verifies API denial before commit", async () => {
  await expect(securePublicTables({ runtimeClient, adminClient, sql })).resolves.toBe(105);
  const queries = adminClient.query.mock.calls.map(([query]) => query);
  expect(queries[0]).toBe("BEGIN");
  expect(queries.indexOf(sql)).toBeGreaterThan(queries.findIndex(q => q.includes("pg_advisory_xact_lock")));
  expect(adminClient.query).toHaveBeenCalledWith(
    "SELECT set_config('fortuno.security_runtime_role', $1, true)", ["hub_owner"],
  );
  expect(queries.findIndex(q => q.includes("AS protected_tables"))).toBeGreaterThan(queries.indexOf(sql));
  expect(queries.at(-1)).toBe("COMMIT");
  expect(queries).not.toContain("ROLLBACK");
});

it("makes no DDL changes when runtime and administrative connections target different databases", async () => {
  runtimeClient.query.mockResolvedValue({ rows: [{ role: "hub_owner", database: "another_database" }] });
  await expect(securePublicTables({ runtimeClient, adminClient, sql })).rejects.toThrow("SECURITY_DATABASE_MISMATCH");
  expect(adminClient.query).not.toHaveBeenCalledWith(sql);
  expect(adminClient.query).toHaveBeenLastCalledWith("ROLLBACK");
});

it("rolls back and fails deployment if runtime ownership cannot be confirmed", async () => {
  adminClient.query.mockImplementation(async (query: string) => {
    if (query === "SELECT current_database() AS database") return { rows: [{ database: "postgres" }] };
    if (query === sql) throw Object.assign(new Error("SECURITY_RUNTIME_OWNERSHIP_REQUIRED"), { code: "P0001" });
    return { rows: [] };
  });
  await expect(securePublicTables({ runtimeClient, adminClient, sql })).rejects.toThrow("SECURITY_RUNTIME_OWNERSHIP_REQUIRED");
  expect(adminClient.query).toHaveBeenLastCalledWith("ROLLBACK");
  expect(adminClient.query).not.toHaveBeenCalledWith("COMMIT");
});

it.each([1, undefined])("rolls back if public access remains or verification has no result", async (remaining) => {
  adminClient.query.mockImplementation(async (query: string) => {
    if (query === "SELECT current_database() AS database") return { rows: [{ database: "postgres" }] };
    if (query.includes("AS protected_tables")) return { rows: remaining === undefined ? [] : [{ protected_tables: 105, unsafe_tables: remaining }] };
    return { rows: [] };
  });
  await expect(securePublicTables({ runtimeClient, adminClient, sql })).rejects.toThrow("SECURITY_VERIFICATION_FAILED");
  expect(adminClient.query).toHaveBeenLastCalledWith("ROLLBACK");
});

it("limits changes to internal public tables, preserves Auth/Storage and never disables security", () => {
  expect(sql).toContain("n.nspname = 'public'");
  expect(sql).toContain("d.deptype = 'e'");
  expect(sql.indexOf("SECURITY_RUNTIME_OWNERSHIP_REQUIRED")).toBeLessThan(sql.indexOf("ALTER TABLE public.%I ENABLE"));
  expect(sql).toContain("REVOKE ALL PRIVILEGES (%I)");
  expect(sql).not.toMatch(/DISABLE ROW LEVEL SECURITY|NO FORCE|DROP |DELETE FROM|TRUNCATE TABLE|CREATE POLICY|USING\s*\(true\)/i);
});
