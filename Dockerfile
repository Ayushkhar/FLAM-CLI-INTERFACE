# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Install build tools required to compile better-sqlite3 from source on Alpine (musl)
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# Prune devDependencies so only production node_modules remain
RUN npm prune --omit=dev

# Stage 2: Production
FROM node:20-alpine

WORKDIR /app

# Copy production dependencies and compiled code from builder stage
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

# Create data directory for SQLite persistence
RUN mkdir -p /app/data

ENV QUEUECTL_DB_PATH=/app/data/queuectl.db
ENV NODE_ENV=production

# Expose dashboard port
EXPOSE 3000

# Copy verification and startup scripts
COPY scripts/ ./scripts/
RUN chmod +x ./scripts/*.sh

# Default command — can be overridden on Render/Docker
CMD ["node", "dist/index.js", "--help"]
