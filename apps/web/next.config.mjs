/** @type {import('next').NextConfig} */
const nextConfig = {
  // Shared workspace packages are plain TS; let Next transpile them.
  transpilePackages: [
    "@setflow/shared",
    "@setflow/api-client",
    "@setflow/workout-engine",
    "@setflow/glasses-adapter",
  ],
};

export default nextConfig;
