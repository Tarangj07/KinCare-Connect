/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Phase 20 (P19-01): standalone output traces the server into a
  // self-contained .next/standalone tree. Without it the runtime image
  // had to copy apps/web/node_modules, whose entries are symlinks into
  // the workspace root pnpm store — broken in the final image.
  output: 'standalone',
  // Phase 36 (P35-1) — disable the Image Optimization endpoint.
  //
  // This application renders no images: there is no `next/image` import, no
  // `<Image>` element and no image component in `packages/ui`. The optimizer
  // endpoint was nevertheless LIVE and UNAUTHENTICATED in the deployed
  // container. `/_next/image?url=/<img>&w=64&q=75` answered HTTP 200 with the
  // image bytes, on a route Next registers unconditionally, on any request
  // from any client.
  //
  // That matters because of advisory 1193733, a critical unauthenticated RCE
  // in the Image Optimization API when AVIF output is used. Two things about
  // the previous posture were wrong:
  //
  //   1. The triage rule concluded "the optimizer has no loader to invoke"
  //      from the absence of a `next/image` import. That is a fact about
  //      APPLICATION USAGE. Next registers `/_next/image` regardless, so the
  //      inference was invalid and the disposition rested on it.
  //   2. The rule cited "GET /_next/image answered 400" as corroboration.
  //      A 400 carrying the optimizer's OWN error string is evidence the
  //      endpoint is PRESENT and executing — not that it is absent.
  //
  // The actual thing protecting the deployment was that `sharp` happened to be
  // absent from the traced standalone tree, so the AVIF path could not run.
  // That is an incidental property of a transitive OPTIONAL dependency, not a
  // control: any future change that pulls `sharp` into the web image would
  // have converted an already-live unauthenticated endpoint into the
  // documented RCE path with every gate still reporting "not reachable".
  //
  // `unoptimized: true` is the supported configuration for exactly this
  // posture. In `next/dist/server/next-server.js` the optimizer is only
  // entered when the loader is `default` AND `unoptimized` is falsy; otherwise
  // Next renders a 404 and never touches the optimizer module. Since the app
  // uses no images, nothing is lost: `<Image>` would render its original src.
  //
  // Verified at runtime, not from this comment — see
  // `scripts/verify-next-image-optimizer.mjs`, which reads the BUILT
  // `images-manifest.json` and probes the running standalone server, and is
  // mutation-tested by `scripts/mutate-next-image-optimizer.mjs`.
  images: {
    unoptimized: true,
  },
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
