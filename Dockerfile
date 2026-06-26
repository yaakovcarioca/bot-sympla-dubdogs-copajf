FROM mcr.microsoft.com/playwright:v1.52.0-noble AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

FROM mcr.microsoft.com/playwright:v1.52.0-noble

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

ENV NODE_ENV=production

VOLUME ["/app/data", "/app/logs"]

CMD ["node", "dist/main.js"]
