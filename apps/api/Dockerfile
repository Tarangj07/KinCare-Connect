# API production image. Multi-stage so the runtime image does not
# contain the build toolchain.

FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /repo

# Copy the full workspace first to take advantage of pnpm's content-
# addressable cache, then prune to the api subtree for the build.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api

RUN corepack prepare pnpm@11.25.0 --activate \
 && pnpm install --filter @ecc/api... --frozen-lockfile=false \
 && pnpm --filter @ecc/api build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Copy only what's needed to run.
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/package.json ./package.json
COPY --from=build /repo/apps/api/node_modules ./node_modules
COPY --from=build /repo/packages ./node_modules/@ecc 2>/dev/null || true

EXPOSE 3000
CMD ["node", "dist/main.js"]
