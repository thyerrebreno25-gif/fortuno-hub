import { expect, it } from "vitest";
import { unstable_getResponseFromNextConfig } from "next/experimental/testing/server";
import nextConfig from "../../../next.config";

it("applies browser security headers to pages and API responses", async () => {
  for (const pathname of ["/login", "/api/onboarding/projects"]) {
    const response = await unstable_getResponseFromNextConfig({ url: "https://hub.test" + pathname, nextConfig });
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
  }
});
