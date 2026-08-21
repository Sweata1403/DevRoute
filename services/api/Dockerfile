# ── Stage 1: Install dependencies ────────────────────────────────
# We use a separate stage so node_modules doesn't bloat the final image
FROM node:20-alpine AS deps

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
# npm ci = clean install (faster, deterministic, uses package-lock.json exactly)
# --omit=dev = skip devDependencies (jest, nodemon etc — not needed in production)


# ── Stage 2: Production image ─────────────────────────────────────
FROM node:20-alpine AS production

# Security: never run as root inside a container
# Create a dedicated user with no special permissions
RUN addgroup -S devroute && adduser -S devroute -G devroute

WORKDIR /app

# Copy only what we need from Stage 1 (not the full build environment)
COPY --from=deps /app/node_modules ./node_modules
COPY src/ ./src/
COPY package.json ./

# Give ownership to our non-root user
RUN chown -R devroute:devroute /app

USER devroute

EXPOSE 3000

# Health check — Docker uses this to know if the container is healthy
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/index.js"]