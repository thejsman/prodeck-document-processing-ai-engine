import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // LLM-backed routes (proposal generation, RAG query) can take several minutes
  // on local hardware. The default Next.js proxy timeout is 30s which causes
  // ECONNRESET before the Python subprocess finishes.
  experimental: {
    proxyTimeout: 600_000, // 10 minutes
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.API_URL ?? "http://localhost:3000"}/:path*`,
      },
    ];
  },
};

export default nextConfig;
