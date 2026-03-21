FROM node:22-bookworm-slim AS build

WORKDIR /app

# Install native build toolchain only in the build stage.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml tsconfig.json ./

RUN corepack enable
RUN pnpm install --frozen-lockfile

COPY src/ src/
COPY skills/ skills/

RUN pnpm run build
RUN pnpm prune --prod

FROM node:22-bookworm-slim

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

# Copy built output + skills + SQL migrations (tsc doesn't copy .sql files).
COPY --from=build /app/dist ./dist
COPY --from=build /app/skills ./skills
COPY --from=build /app/src/agent/db/migrations ./dist/agent/db/migrations

# Make echoclaw CLI available in PATH.
RUN ln -s /app/dist/cli.js /usr/local/bin/echoclaw \
    && chmod +x /app/dist/cli.js

EXPOSE 4201

CMD ["node", "dist/agent/server.js"]
