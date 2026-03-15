import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  // Turbopack is the default bundler in Next.js 16
  turbopack: {},
};

export default nextConfig;
