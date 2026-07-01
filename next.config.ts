import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Build enxuto p/ container (Docker/EasyPanel): copia só o necessário.
  output: "standalone",
};

export default nextConfig;
