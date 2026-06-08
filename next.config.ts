import type { NextConfig } from "next";

const basePath = process.env.BASE_PATH || "";

const nextConfig: NextConfig = {
  basePath: basePath || undefined,
  serverExternalPackages: [
    "bullmq",
    "ioredis",
    "node-7z",
    "7zip-bin",
    "@tus/server",
    "@tus/s3-store",
    "@tus/file-store",
    "pg",
  ],
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
