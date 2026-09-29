# Web production image. Next.js standalone output (Phase 20).
#
# P19-01: the previous runtime stage copied apps/web/node_modules, but
# under pnpm's isolated linker those entries are symlinks into the
# workspace root's node_modules/.pnpm store, which was never copied — the
# container could not start Next.js. The image now uses Next's
# `output: 'standalone'`, which traces the server into a self-contained
# .next/standalone tree (only the files and node_modules the app actually
# imports). No node_modules copy, no npx at startup.
#
# Base image: node:24-alpine. The repository pins pnpm@11.25.0
# (packageManager), whose engines require Node >= 22.13; the pnpm CLI
# aborts on older Node. Node 24 also matches the local toolchain.

FROM node:24-alpine AS build
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
WORKDIR /repo

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web

RUN pnpm install --filter @ecc/web... --frozen-lockfile \
 && pnpm --filter @ecc/web build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Standalone server bundle: the traced runtime tree (`.next/standalone`)
# mirrors the workspace layout, so the entry point is
# apps/web/server.js and static assets belong next to the build output.
# Only files Next actually traced are copied, so dev dependencies, tests
# and application source are absent from the image.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public

# Phase 20: unprivileged runtime user.
USER 1000:1000

EXPOSE 3001

# Preserve the existing web port (3001). The standalone server.js binds
# to $PORT and $HOSTNAME; 0.0.0.0 so the container is reachable outside
# its own network namespace.
ENV PORT=3001 HOSTNAME=0.0.0.0

# Server-side fetches (e.g. the /health page) read NEXT_PUBLIC_API_URL at
# runtime from the environment; supply it with -e when running the
# container. Nothing is baked in.
# The traced server is started directly — no npx, no package manager, and
# no node_modules resolution against a host workspace at container start.
CMD ["node", "apps/web/server.js"]
