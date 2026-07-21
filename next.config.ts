import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // We need to allow importing .glsl files as raw strings
  webpack(config) {
    config.module.rules.push({
      test: /\.glsl$/,
      type: "asset/source",
    });
    return config;
  },
};

export default nextConfig;
