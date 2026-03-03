# deeprun Production Dockerfile
FROM node:20-alpine AS base

# Install system dependencies
RUN apk add --no-cache \
    git \
    curl \
    postgresql-client \
    && rm -rf /var/cache/apk/*

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy source code
COPY src/ ./src/
COPY public/ ./public/

# Build application
RUN npm run build

# Remove dev dependencies and source
RUN rm -rf src/ node_modules/ && npm ci --only=production

# Create non-root user
RUN addgroup -g 1001 -S deeprun && \
    adduser -S deeprun -u 1001 -G deeprun

# Create data directories
RUN mkdir -p /app/.data /app/.deeprun /app/.workspace && \
    chown -R deeprun:deeprun /app

USER deeprun

# Environment defaults
ENV NODE_ENV=production
ENV PORT=3000
ENV CORS_ALLOWED_ORIGINS=http://localhost:3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:$PORT/api/health || exit 1

EXPOSE 3000

CMD ["node", "dist/server.js"]