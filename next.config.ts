import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'" },
      ],
    }];
  },
};

export default nextConfig;
