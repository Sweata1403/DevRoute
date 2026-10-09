# Stage 1: production dependencies only, so the final image never carries jest or supertest
FROM node:25-alpine AS deps
RUN apk upgrade --no-cache
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# Stage 2: test image, built only by CI, adds dev dependencies and the tests folder on top of deps
FROM deps AS test
RUN npm ci
COPY src/ ./src/
COPY tests/ ./tests/
CMD ["npm", "test"]

# Stage 3: production image, the last stage, so a plain docker build uses it by default
FROM node:25-alpine AS production
RUN apk upgrade --no-cache
RUN addgroup -S devroute && adduser -S devroute -G devroute
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY src/ ./src/
COPY package.json ./
RUN chown -R devroute:devroute /app
USER devroute
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "src/index.js"]