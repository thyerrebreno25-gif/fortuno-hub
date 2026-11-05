import { expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { dashboardDestinations } from "./destinations";
it("keeps dashboard destinations valid and links every sidebar module from Inicio", () => {
 for (const item of dashboardDestinations) expect(existsSync(join(process.cwd(), "src/app/(platform)", item.href, "page.tsx")), item.href).toBe(true);
 const sidebar = readFileSync("src/components/platform-shell.tsx", "utf8").split("const menuItems: MenuItem[] = [")[1].split("];")[0];
 const paths = [...sidebar.matchAll(/href:\s*"([^"]+)"/g)].map((match) => match[1]).filter((path) => !["/inicio", "/dashboard"].includes(path));
 // The management-only BI link is offered by Inicio, outside the legacy dashboard list.
 expect(dashboardDestinations.map((item) => item.href)).toEqual(expect.arrayContaining(paths.filter(path => path !== "/painel-gerencial")));
 const home = readFileSync("src/app/(platform)/inicio/page.tsx", "utf8").split("const features: Feature[] = [")[1].split("];")[0];
 const homePaths = [...home.matchAll(/href:\s*"([^"]+)"/g)].map(match => match[1]);
 expect(homePaths).toEqual(expect.arrayContaining(paths));
 for (const href of homePaths) expect(existsSync(join(process.cwd(), "src/app/(platform)", href, "page.tsx")), href).toBe(true);
});
