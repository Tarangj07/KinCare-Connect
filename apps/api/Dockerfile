# API production image. Multi-stage so the runtime image does not
# contain the build toolchain.
#
# Phase 20 (P19-01): the runtime dependency tree is produced by
# `pnpm deploy --legacy --prod`, which materialises a SELF-CONTAINED
# production node_modules. The previous runtime stage copied
# apps/api/node_modules, but under pnpm's isolated linker every entry
# there is a symlink into the workspace root's node_modules/.pnpm store,
# which was never copied into the runtime image — so the container could
# not resolve a single dependency at startup. `pnpm deploy` copies the
# required store subtree into the target directory, which is exactly what
# a flat runtime image needs.
#
# Base image: node:24-alpine. The repository pins pnpm@11.25.0
# (packageManager), whose engines require Node >= 22.13; the pnpm CLI
# aborts on older Node ("No such built-in module: node:sqlite"). Node 24
# is also what the local toolchain runs, so the container matches the
# verified environment.

FROM node:24-alpine AS build
# Prisma's engines (query/schema/migration) link against OpenSSL. Alpine
# ships no libssl, so without this every database operation fails with
# "Error loading shared library libssl.so.3". Verified: this was a real
# runtime failure before openssl was added.
RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
WORKDIR /repo

# Manifests first for layer caching.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/api/package.json ./apps/api/package.json
COPY apps/api/prisma ./apps/api/prisma

RUN pnpm install --filter @ecc/api... --frozen-lockfile

# Full api source only for the build step. Tests and dev tooling are
# excluded from the runtime by `deploy --prod` and the explicit copies
# below.
COPY apps/api ./apps/api

RUN pnpm --filter @ecc/api exec prisma generate \
 && pnpm --filter @ecc/api build \
 && pnpm --filter @ecc/api deploy --legacy --prod /repo/deploy \
 && rm -rf /repo/deploy/src /repo/deploy/test /repo/deploy/scripts \
 && mkdir -p /app \
 && cp /repo/deploy/package.json /app/package.json \
 && cp -r /repo/deploy/node_modules /app/node_modules \
 && cp -r /repo/apps/api/dist /app/dist \
 && cp -r /repo/apps/api/prisma /app/prisma \
 && cd /app \
 && node -e 'const fs=require("fs");for(const d of ["node_modules","node_modules/.pnpm/node_modules"])fs.rmSync(d+"/@ecc",{recursive:true,force:true});for(const e of fs.readdirSync("node_modules/.pnpm"))if(e.startsWith("@ecc+"))fs.rmSync("node_modules/.pnpm/"+e,{recursive:true,force:true})' \
 && node -e 'const fs=require("fs"),p=require("path"),bad=[];(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);if(e.isSymbolicLink()){try{fs.statSync(f)}catch{bad.push(f)}}else if(e.isDirectory())w(f)}})("/app");if(bad.length){console.error("BROKEN SYMLINKS: "+bad.join(" "));process.exit(1)}console.log("runtime tree is self-contained: no broken symlinks")'

# Phase 21 (L-03) part 1 — mode model, applied HERE rather than after the
# runtime-stage COPY. A chmod in the runtime stage rewrites every inode
# and buildkit stores it as an additional layer, which duplicated the
# whole 154 MB tree and grew the image by ~220 MB for no functional
# gain. Normalising the assembled tree before it is copied achieves the
# same result with one layer.
#
#   directories              0555  r-x for everyone
#   non-executable files     0444  r-- for everyone
#   executable files         0555  r-x for everyone
#   STORAGE_DIR          0700 uid 1000   the only writable path
#
# Two `find` passes normalise every regular file by its ORIGINAL execute
# bit — so node_modules/.bin/prisma and the native engines keep their +x
# while sources become 0444 — and a third makes directories 0555. Every
# mode is set explicitly, so no group/other write bit inherited from the
# build tools can survive. Symlinks are skipped: they carry no meaningful
# mode on Linux, and a recursive chmod would dereference them.
RUN find /app -type f -perm /111 -exec chmod 0555 {} + \
 && find /app -type f ! -perm /111 -exec chmod 0444 {} + \
 && find /app -type d -exec chmod 0555 {} +

FROM node:24-alpine AS runtime
# Same reason as the build stage: the Prisma engines shipped in
# node_modules are linked against OpenSSL and cannot load without it.
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app

# Phase 19: the image must not carry a default document-storage location.
# STORAGE_DIR is deliberately left unset: the API refuses to start in
# production without it, because documents are protected health information
# and must not default to a path inside the application directory. Mount a
# volume and point STORAGE_DIR at it (the mounted path must be writable by
# uid 1000 — the non-root user this image runs as).
#
# No secrets, no .env, no host node_modules, no test/source artifacts:
# the runtime stage receives exactly dist/, prisma/, package.json and a
# self-contained production node_modules.

# Phase 20: unprivileged runtime user (node:24-alpine provides uid/gid
# 1000 "node"). The only path the process writes to is STORAGE_DIR, which
# is operator-mounted.
#
# Phase 21 (L-03) part 2 — the tree is copied root-owned. Phase 20 copied
# it --chown=1000:1000, so all 8330 files below /app were owned *and*
# writable by uid 1000: a compromised process could append to
# dist/main.js, rewrite prisma/schema.prisma or drop a module into
# node_modules to persist itself for the life of the container. Nothing in
# the application writes to /app — StorageService is the only writer and
# is directed at STORAGE_DIR — so root ownership costs nothing. The modes
# were already fixed in the build stage and are carried through by COPY.
#
# The guard below re-reads the tree *after* the COPY, so it validates what
# actually ships rather than what was staged. COPY copies the *contents*
# of the source directory, so the destination /app keeps the mode WORKDIR
# gave it (0755); `chmod 0555 /app` restores the model for that one
# directory. Both commands only touch metadata, so this layer holds no
# file content.
COPY --from=build --chown=0:0 /app ./
RUN chmod 0555 /app \
 && node -e 'const fs=require("fs"),p=require("path"),bad=[];(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name),s=fs.lstatSync(f);if(s.isSymbolicLink())continue;if(s.uid!==0||s.gid!==0||(s.mode&0o022)!==0)bad.push(f+" uid="+s.uid+" gid="+s.gid+" mode="+(s.mode&0o7777).toString(8));if(s.isDirectory())w(f)}})("/app");if(bad.length){console.error("NOT ROOT-OWNED OR GROUP/OTHER-WRITABLE: "+bad.slice(0,10).join(" "));process.exit(1)}console.log("application tree is root-owned and not writable by uid 1000")'
USER 1000:1000

EXPOSE 3000

# Liveness only: the database is not consulted, so a database outage does
# not cause the orchestrator to restart a healthy process. Use
# /api/v1/health/ready for traffic gating.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||3000,path:'/api/v1/health'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# Migrations can be applied from this image as a deployment step: the
# prisma CLI, schema and migrations are all in the runtime tree (all are
# declared production dependencies). Invoke the CLI BY PATH:
#
#   docker run --rm -e DATABASE_URL="$DATABASE_URL" <image> \
#     node_modules/.bin/prisma migrate deploy
#
# Do NOT use the bare form `docker run <image> prisma migrate deploy`.
# `prisma` is not on PATH, and the inherited `docker-entrypoint.sh` from
# node:*-alpine rewrites an argv[0] it cannot resolve to `node "$@"`,
# producing `node prisma migrate deploy`. `/app/prisma` is the migration
# *directory*, not a program, so that fails with
# `Error: Cannot find module '/app/prisma'` (exit 1).
#
# Equivalent form that bypasses argv rewriting entirely (both verified
# against a real image and a throwaway PostgreSQL in Phase 21):
#   docker run --rm --entrypoint node -e DATABASE_URL="$DATABASE_URL" \
#     <image> node_modules/prisma/build/index.js migrate deploy
#
# Migrations are read-only here: `prisma/` is 0444 root-owned, which the
# CLI does not need to change.
CMD ["node", "dist/main.js"]
