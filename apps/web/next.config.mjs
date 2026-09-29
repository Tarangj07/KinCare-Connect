/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Phase 20 (P19-01): standalone output traces the server into a
  // self-contained .next/standalone tree. Without it the runtime image
  // had to copy apps/web/node_modules, whose entries are symlinks into
  // the workspace root pnpm store — broken in the final image.
  output: 'standalone',
  transpilePackages: ['@ecc/ui', '@ecc/types', '@ecc/validation'],
  experimental: {
    typedRoutes: false,
  },
  eslint: {
    // Local ESLint runs separately via `pnpm lint`; avoid Next's built-in
    // pass hiding our strict gates.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
