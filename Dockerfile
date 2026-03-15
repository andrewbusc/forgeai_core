# deeprun Production Dockerfile
FROM node:20-alpine AS builder

# Install system dependencies required for build steps
RUN apk add --no-cache \
    git \
    curl \
    postgresql-client \
    && rm -rf /var/cache/apk/*

WORKDIR /app

# Copy package files and install all deps (including dev)
COPY package*.json ./
COPY package-lock.json ./
RUN npm ci

# Copy sources and build
COPY tsconfig.json ./
COPY prisma ./prisma
COPY src/ ./src/
COPY public/ ./public/
RUN npm run prisma:generate || true
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Install only production deps
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# Copy built artifacts from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

# Create non-root user and data directories
RUN addgroup -g 1001 -S deeprun && \
    adduser -S deeprun -u 1001 -G deeprun && \
    mkdir -p /app/.data /app/.deeprun /app/.workspace && \
    chown -R deeprun:deeprun /app

USER deeprun

ENV PORT=3000
ENV CORS_ALLOWED_ORIGINS=http://localhost:3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:$PORT/api/health || exit 1

CMD ["node", "dist/server.js"]