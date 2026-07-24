FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && chown -R node:node /app

COPY --chown=node:node server.mjs ./
COPY --chown=node:node src ./src
COPY --chown=node:node dist ./dist

ENV NODE_ENV=production
ENV SOLVEN_PUBLIC_ROOT=/app/dist
ENV HOST=0.0.0.0

USER node
CMD ["node", "server.mjs"]
