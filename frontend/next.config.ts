import type { NextConfig } from "next";

/**
 * Same-origin API: the browser calls /api/* on the dashboard's own host and Next proxies it to the
 * FastAPI backend, so one HTTPS origin (e.g. a tunnel) serves both and no CORS is involved.
 * BACKEND_URL is read when the config is evaluated at BUILD time (rewrites go into the build manifest).
 */
const BACKEND_URL = (process.env.BACKEND_URL ?? "http://127.0.0.1:8010").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` }];
  },
};

export default nextConfig;
