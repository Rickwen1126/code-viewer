# Multi-stage build: backend + frontend in one image
FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN pnpm install --frozen-lockfile

# Build shared types
FROM deps AS build-shared
COPY packages/shared/ packages/shared/
RUN pnpm --filter @code-viewer/shared build

# Build frontend (static files)
FROM build-shared AS build-frontend
COPY frontend/ frontend/
RUN pnpm --filter @code-viewer/frontend build

# Build backend
FROM build-shared AS build-backend
COPY backend/ backend/
RUN pnpm --filter @code-viewer/backend build

# Production image: backend serves API, frontend served via static
FROM base AS production
COPY --from=deps /app/node_modules node_modules/
COPY --from=deps /app/packages/shared/node_modules packages/shared/node_modules/
COPY --from=deps /app/backend/node_modules backend/node_modules/
COPY --from=build-shared /app/packages/shared/ packages/shared/
COPY --from=build-backend /app/backend/dist/ backend/dist/
COPY --from=build-backend /app/backend/package.json backend/
COPY --from=build-frontend /app/frontend/dist/ frontend/dist/

# Backend serves on 4800, frontend static on 4801
ENV PORT=4800
ENV HOST=0.0.0.0
EXPOSE 4800 4801

# Start both backend and a simple static server for frontend
CMD ["sh", "-c", "npx serve frontend/dist -l 4801 -s & node backend/dist/index.js"]
