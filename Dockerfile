# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# Stage 2: Production
FROM node:20-alpine

WORKDIR /app

# Install only production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy built output from builder stage
COPY --from=builder /app/dist ./dist

# Create data directory for SQLite persistence
RUN mkdir -p /app/data

ENV QUEUECTL_DB_PATH=/app/data/queuectl.db
ENV NODE_ENV=production

# Expose dashboard port
EXPOSE 3000

# Default entrypoint — user can override with specific commands
ENTRYPOINT ["node", "dist/index.js"]
CMD ["--help"]
