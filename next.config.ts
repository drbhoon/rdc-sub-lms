import type { NextConfig } from "next";

// Mounted under /lms on the HR platform, at the root locally and on Railway.
// basePath is baked into the bundle at build time, so BASE_PATH must be a
// Docker build arg AND stay in the runtime env (next.config is re-evaluated
// when the server starts).
const basePath = process.env.BASE_PATH || "";

const nextConfig: NextConfig = {
  experimental: { serverActions: { bodySizeLimit: "100mb" } },
  ...(basePath ? { basePath } : {}),
  env: {
    // Consumed on the client by src/lib/base-path.ts
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default nextConfig;
