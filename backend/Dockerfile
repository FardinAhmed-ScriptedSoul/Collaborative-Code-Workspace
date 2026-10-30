FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

RUN groupadd --system app && useradd --system --gid app --no-create-home app && mkdir -p /data/yjs && chown -R app:app /data/yjs
COPY --chown=app:app src ./src
ENV YPERSISTENCE=/data/yjs
USER app

EXPOSE 3000
CMD ["node", "src/server.js"]
