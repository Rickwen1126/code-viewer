FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/protocol/package.json packages/protocol/
COPY backend/package.json backend/

RUN pnpm install --frozen-lockfile

COPY packages/protocol/ packages/protocol/
COPY backend/ backend/

RUN pnpm --filter @code-viewer/protocol build && \
    pnpm --filter @code-viewer/backend build

FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/packages/protocol/dist ./packages/protocol/dist
COPY --from=builder /build/packages/protocol/package.json ./packages/protocol/
COPY --from=builder /build/backend/dist ./dist
COPY --from=builder /build/backend/package.json ./
COPY --from=builder /build/backend/node_modules ./backend_modules

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/index.js"]
