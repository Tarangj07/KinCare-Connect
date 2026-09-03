/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
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
