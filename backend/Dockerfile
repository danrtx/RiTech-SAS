FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json nest-cli.json ./
COPY src/ src/

RUN npm run build && npm prune --production


FROM node:20-alpine

RUN apk add --no-cache tini curl
RUN addgroup -S ritech && adduser -S ritech -G ritech

WORKDIR /app

COPY --from=build --chown=ritech:ritech /app/dist ./dist
COPY --from=build --chown=ritech:ritech /app/node_modules ./node_modules
COPY --from=build --chown=ritech:ritech /app/package.json ./

USER ritech

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main"]
