# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Build the application (skip env validation - env vars are runtime only)
ENV SKIP_ENV_VALIDATION=true
RUN pnpm build

# Production stage
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy built files
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Copy migration files, migrate script, and entrypoint
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/scripts/migrate.js ./migrate.js
COPY --from=builder /app/scripts/docker-entrypoint.sh ./docker-entrypoint.sh

# Copy postgres driver from builder (needed for migration script)
COPY --from=builder /app/node_modules/.pnpm/postgres@3.4.8/node_modules/postgres ./node_modules/postgres

RUN chmod +x ./docker-entrypoint.sh && \
    chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["./docker-entrypoint.sh"]
