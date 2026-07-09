/** @type {import('next').NextConfig} */
const nextConfig = {
  // Shared workspace packages are plain TS; let Next transpile them.
  transpilePackages: [
    "@setflow/shared",
    "@setflow/api-client",
    "@setflow/workout-engine",
    "@setflow/glasses-adapter",
  ],
  // The glasses Web App is a self-contained bundle staged into
  // public/glasses-app/ by apps/glasses/build.mjs. public/ files serve at
  // /glasses-app/index.html but not at the bare /glasses-app/ path, so map
  // the directory forms to the file (query strings like ?t= pass through).
  async rewrites() {
    return [
      { source: "/glasses-app", destination: "/glasses-app/index.html" },
      { source: "/glasses-app/", destination: "/glasses-app/index.html" },
    ];
  },
};

export default nextConfig;
