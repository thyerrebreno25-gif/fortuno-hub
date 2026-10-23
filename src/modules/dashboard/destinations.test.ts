import { expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { dashboardDestinations } from "./destinations";
it("links every sidebar module to an existing result or tool page", () => {
 for (const item of dashboardDestinations) expect(existsSync(join(process.cwd(), "src/app/(platform)", item.href, "page.tsx")), item.href).toBe(true);
 const sidebar = readFileSync("src/components/platform-shell.tsx", "utf8").split("const menuItems: MenuItem[] = [")[1].split("];")[0];
 const paths = [...sidebar.matchAll(/href:\s*"([^"]+)"/g)].map((match) => match[1]).filter((path) => !["/inicio", "/dashboard"].includes(path));
 expect(dashboardDestinations.map((item) => item.href)).toEqual(expect.arrayContaining(paths));
});
