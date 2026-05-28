import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // standalone output is required for the Docker image but creates symlinks that
  // require elevated privileges on Windows (EPERM -4048). Only enable it when
  // explicitly requested, e.g. in CI/Docker: NEXT_STANDALONE=1 pnpm build
  ...(process.env.NEXT_STANDALONE === "1" ? { output: "standalone" } : {}),
  // Mermaid v11 is ESM-only — webpack must transpile it to avoid production
  // build failures where the mermaid chunk loads but evaluates incorrectly.
  transpilePackages: ["mermaid"],
  // LLM-backed routes (proposal generation, RAG query) can take several minutes
  // on local hardware. The default Next.js proxy timeout is 30s which causes
  // ECONNRESET before the Python subprocess finishes.
  experimental: {
    proxyTimeout: 600_000, // 10 minutes
    // Microsite HTML + embedded base64 logos can exceed the default 10 MB proxy limit
    middlewareClientMaxBodySize: 52_428_800, // 50 MB
  },
  async rewrites() {
    // Use `fallback` so Next.js Route Handlers (e.g. generate-stream SSE proxy)
    // take precedence. fallback rewrites only apply when no matching route/handler
    // is found in the filesystem.
    return {
      beforeFiles: [],
      afterFiles: [],
      fallback: [
        {
          source: "/api/:path*",
          destination: `${process.env.API_URL ?? "http://localhost:3000"}/:path*`,
        },
      ],
    };
  },
};

export default nextConfig;
