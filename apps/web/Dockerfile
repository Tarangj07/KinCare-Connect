# Web production image. Next.js standalone output.
FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /repo

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web

RUN corepack prepare pnpm@11.25.0 --activate \
 && pnpm install --filter @ecc/web... --frozen-lockfile=false \
 && pnpm --filter @ecc/web build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /repo/apps/web/.next ./.next
COPY --from=build /repo/apps/web/public ./public
COPY --from=build /repo/apps/web/package.json ./package.json
COPY --from=build /repo/apps/web/node_modules ./node_modules
COPY --from=build /repo/apps/web/next.config.mjs ./next.config.mjs

EXPOSE 3001
CMD ["npx", "next", "start", "-p", "3001"]
