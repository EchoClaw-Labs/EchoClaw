FROM node:22-bookworm-slim AS deps

WORKDIR /app

# Install native build toolchain only in the deps stage.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod

FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml ./

# Copy built output + skills + SQL migrations (tsc doesn't copy .sql files)
COPY dist/ dist/
COPY skills/ skills/
COPY src/agent/db/migrations/ dist/agent/db/migrations/

# Make echoclaw CLI available in PATH
RUN ln -s /app/dist/cli.js /usr/local/bin/echoclaw \
    && chmod +x /app/dist/cli.js

EXPOSE 4201

CMD ["node", "dist/agent/server.js"]
