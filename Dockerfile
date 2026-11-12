FROM node:24-alpine
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY src ./src
COPY assets ./assets
# The order store is a JSON file; give the unprivileged user a place to write it.
RUN mkdir -p /app/local/data && chown -R node:node /app/local
USER node
EXPOSE 8787
CMD ["node", "src/server.js", "--http"]
