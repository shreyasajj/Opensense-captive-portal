FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-alpine

RUN apk add --no-cache tini

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY config.js server.js ./
COPY db/ ./db/
COPY middleware/ ./middleware/
COPY routes/ ./routes/
COPY services/ ./services/

RUN mkdir -p /app/db && chown -R node:node /app/db

USER node

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
